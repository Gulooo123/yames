use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// Play mode derived from `onset_efficiency`. ≥ 0.65 → Structured
/// (the player is locking in to the beat grid); < 0.65 → Noodling
/// (free improvisation against the metronome).
#[derive(Clone, Copy, Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayMode {
    Structured,
    Noodling,
}

/// Status of model components on disk.
#[derive(Debug, Clone, Serialize)]
pub struct ModelStatus {
    /// Whether the brain model is downloaded
    #[serde(rename = "brainReady")]
    pub brain_ready: bool,
    /// Which tier is downloaded (null if none)
    #[serde(rename = "brainTier")]
    pub brain_tier: Option<String>,
    /// Size on disk in bytes
    #[serde(rename = "brainSizeBytes")]
    pub brain_size_bytes: u64,
    /// Whether voice models are downloaded
    #[serde(rename = "voiceReady")]
    pub voice_ready: bool,
    /// Size on disk in bytes
    #[serde(rename = "voiceSizeBytes")]
    pub voice_size_bytes: u64,
}

/// Get the models directory inside the app data dir.
fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(data_dir.join("models"))
}

/// Check which models are available on disk.
pub fn check_model_status(app: &AppHandle) -> Result<ModelStatus, String> {
    let dir = models_dir(app)?;
    let brain_dir = dir.join("brain");
    let voice_dir = dir.join("voice");

    let brain_ready = brain_dir.join("model.bin").exists();
    let brain_tier = if brain_ready {
        std::fs::read_to_string(brain_dir.join("tier")).ok()
    } else {
        None
    };
    let brain_size_bytes = if brain_ready { dir_size(&brain_dir) } else { 0 };

    // `voice_ready` powers the UI banner + the "Download voices" button.
    // For the user to ACTUALLY hear a Piper voice, BOTH the Piper
    // engine binary AND at least the default (lessac) ONNX model must
    // be on disk — otherwise `tts::speak` silently falls back to macOS
    // `say`.
    //
    // We use the fast filesystem-only `piper_runnable` here (called on
    // every UI render of the coach card) — spawning a `piper --help`
    // subprocess every refresh would be wasteful. The deeper "binary
    // actually launches on this machine" probe is `piper_smoke_test`,
    // run once by the download pipeline; if that passed at install
    // time we trust the on-disk state.
    //
    // The ONNX is ALSO size-gated against `MIN_ONNX_BYTES` so a 1 KB
    // HTML error page that curl saved during a flaky download can't
    // pass for a working voice — the user's "fix corrupted voices"
    // case from 2026-05-18.
    let piper_ready = crate::tts::piper_runnable(&dir);
    let lessac_onnx = voice_dir.join("en_US-lessac-medium.onnx");
    let onnx_ready = lessac_onnx
        .metadata()
        .map(|m| m.len() >= crate::tts::MIN_ONNX_BYTES)
        .unwrap_or(false);
    let voice_ready = piper_ready && onnx_ready;
    let voice_size_bytes = if voice_dir.exists() {
        dir_size(&voice_dir)
    } else {
        0
    };

    Ok(ModelStatus {
        brain_ready,
        brain_tier,
        brain_size_bytes,
        voice_ready,
        voice_size_bytes,
    })
}

/// Write model data from the frontend to disk.
pub fn write_model_file(
    app: &AppHandle,
    component: &str,
    filename: &str,
    data: &[u8],
) -> Result<String, String> {
    let dir = models_dir(app)?;
    let component_dir = dir.join(component);
    std::fs::create_dir_all(&component_dir)
        .map_err(|e| format!("Failed to create directory: {e}"))?;
    let path = component_dir.join(filename);
    std::fs::write(&path, data).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Delete all downloaded models.
pub fn delete_models(app: &AppHandle) -> Result<(), String> {
    let dir = models_dir(app)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Failed to delete models: {e}"))?;
    }
    Ok(())
}

/// Get the models directory path (for frontend to know where files go).
pub fn get_models_path(app: &AppHandle) -> Result<String, String> {
    let dir = models_dir(app)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Recursively compute directory size in bytes.
fn dir_size(path: &PathBuf) -> u64 {
    if !path.exists() {
        return 0;
    }
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

// ---------------------------------------------------------------------------
// Backend model download (survives frontend hot-reloads)
// ---------------------------------------------------------------------------

/// Shared cancel flag for the active download.
pub type DownloadCancelFlag = Arc<AtomicBool>;

/// Progress event emitted to the frontend during download.
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub component: String,
    #[serde(rename = "downloadedBytes")]
    pub downloaded_bytes: u64,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    pub fraction: f64,
    pub done: bool,
}

/// Download a model file from `url` to the models directory.
/// Runs on a background thread. Emits "model-download-progress" events.
/// After the brain model, automatically downloads Piper binary + voice models.
/// Returns immediately. The cancel flag can be set to abort.
pub fn start_download(
    app: AppHandle,
    url: String,
    component: String,
    filename: String,
    tier: String,
    cancel: DownloadCancelFlag,
) {
    std::thread::spawn(move || {
        let models_dir = match app.path().app_data_dir() {
            Ok(d) => d.join("models"),
            Err(e) => {
                let _ = app.emit(
                    "model-download-complete",
                    serde_json::json!({ "success": false, "error": format!("{e}") }),
                );
                return;
            }
        };

        // Step 1: Download the brain model (skip if already present)
        let brain_path = models_dir.join(&component).join(&filename);
        if !brain_path.exists() {
            let result = do_download(&app, &url, &component, &filename, &tier, &cancel, "brain");
            if let Err(e) = result {
                let event = if e == "cancelled" {
                    serde_json::json!({ "success": false, "cancelled": true })
                } else {
                    serde_json::json!({ "success": false, "error": e })
                };
                let _ = app.emit("model-download-complete", event);
                return;
            }
        } else {
            // Brain exists, just ensure tier marker is correct
            let tier_path = models_dir.join(&component).join("tier");
            let _ = std::fs::write(&tier_path, &tier);
        }

        // Step 2: Download Piper binary + voices (if not already present)

        // Download Piper binary. The completeness check has to gate on
        // the dylibs too, not just the `piper` executable — an earlier
        // build shipped with a check that only verified `piper/piper`
        // existed. When a previous tarball extraction had dropped the
        // shared libraries (`libespeak-ng.1.dylib`,
        // `libonnxruntime.1.14.1.dylib`, `libpiper_phonemize.1.dylib`)
        // the executable was on disk but crashed at launch with
        // `dyld: Library not loaded`. The old check then skipped the
        // re-download because the binary "existed", leaving the user
        // permanently stuck. We now require all four files (binary +
        // three dylibs) and wipe the piper/ dir before re-extracting
        // so a partial leftover can't shadow the fresh tarball.
        // Capture engine/voice failures as we go so the final
        // `model-download-complete` event can report ACCURATE success
        // instead of falsely claiming the install is done. Before this
        // tracking was added, the function unconditionally emitted
        // `{ success: true }` at the end even when curl had failed on
        // every URL (e.g. behind a VPN that blocks HuggingFace), so
        // the UI showed "Practice coach available!" with no voices on
        // disk — silently broken. See the per-failure assignments
        // below and the final-state check at the end of this thread.
        let mut piper_error: Option<String> = None;
        let mut voice_errors: Vec<(String, String)> = Vec::new();

        let piper_dir = models_dir.join("piper");
        // Skip the engine install only if it already PASSES the smoke
        // test (binary launches, libraries resolve). Filesystem
        // presence isn't enough — a half-extracted or corrupted prior
        // install would silently pass a `.exists()` check and then
        // crash at speak time.
        if crate::tts::piper_smoke_test(&piper_dir).is_err() {
            let _ = app.emit(
                "model-download-progress",
                DownloadProgress {
                    component: "Piper TTS engine".to_string(),
                    downloaded_bytes: 0,
                    total_bytes: 0,
                    fraction: 0.0,
                    done: false,
                },
            );
            let piper_url = crate::tts::piper_binary_url();
            let tar_path = models_dir.join("piper.tar.gz");
            if let Err(e) = curl_download(&app, piper_url, &tar_path, &cancel, "Piper TTS engine") {
                if e == "cancelled" {
                    let _ = app.emit(
                        "model-download-complete",
                        serde_json::json!({ "success": false, "cancelled": true }),
                    );
                    return;
                }
                eprintln!("[yames] Failed to download Piper binary: {e}");
                piper_error = Some(e.clone());
                let _ = app.emit(
                    "model-download-progress",
                    DownloadProgress {
                        component: format!("Piper TTS engine (failed: {e})"),
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        fraction: 0.0,
                        done: true,
                    },
                );
            } else {
                // Sanity-check the tarball size before handing it to
                // tar. HuggingFace (or a corporate proxy / VPN with TLS
                // interception) can serve a redirect page or
                // maintenance HTML in place of the real asset — those
                // are KB, not MB. The real Piper macOS tarball is
                // ~24 MB; we floor at 15 MB so the check is robust to
                // future minor release-size shifts but still catches
                // the common "served a wrong/truncated payload" mode.
                const MIN_PIPER_TARBALL_BYTES: u64 = 15 * 1024 * 1024;
                let tar_size = std::fs::metadata(&tar_path).map(|m| m.len()).unwrap_or(0);
                if tar_size < MIN_PIPER_TARBALL_BYTES {
                    eprintln!(
                        "[yames] Piper tarball is only {tar_size} bytes (expected >= {MIN_PIPER_TARBALL_BYTES}) \u{2014} likely corrupted or intercepted",
                    );
                    let _ = std::fs::remove_file(&tar_path);
                    piper_error = Some(format!(
                        "downloaded archive is only {tar_size} bytes (expected at least {} MB) \u{2014} the file may be corrupted or intercepted by a proxy",
                        MIN_PIPER_TARBALL_BYTES / (1024 * 1024),
                    ));
                } else {
                    // Wipe stale piper/ only after download succeeds and tarball
                    // size is verified — so a failed download never destroys a
                    // working install. `tar xzf` extracts side-by-side and won't
                    // remove orphan files, so we still need to clear before extract.
                    if piper_dir.exists() {
                        if let Err(e) = std::fs::remove_dir_all(&piper_dir) {
                            eprintln!("[yames] Failed to remove stale piper/: {e}");
                        }
                    }
                    // Extract tar.gz
                    let _ = std::fs::create_dir_all(&models_dir);
                    let extract = std::process::Command::new("tar")
                        .arg("xzf")
                        .arg(&tar_path)
                        .arg("-C")
                        .arg(&models_dir)
                        .output();
                    let _ = std::fs::remove_file(&tar_path);
                    match extract {
                        Ok(out) if !out.status.success() => {
                            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                            eprintln!(
                                "[yames] tar exited {} extracting Piper: {stderr}",
                                out.status,
                            );
                            piper_error = Some(format!("tar failed extracting Piper: {stderr}"));
                        }
                        Err(e) => {
                            eprintln!("[yames] Failed to extract Piper: {e}");
                            piper_error = Some(format!("failed to run tar: {e}"));
                        }
                        _ => {}
                    }
                    // Strip macOS Gatekeeper quarantine attribute
                    // recursively. Files downloaded via curl carry the
                    // `com.apple.quarantine` xattr; after a system
                    // security update macOS can refuse to load
                    // unsigned dylibs that have it set, even ones that
                    // worked yesterday. Symptom: dyld error "Library
                    // not loaded: @rpath/...dylib" with all files
                    // visibly present on disk. Stripping the xattr
                    // pre-emptively avoids this whole class of failure.
                    // Errors are swallowed because `xattr` exits
                    // non-zero when the attribute isn't set, which is
                    // the success case for us.
                    let _ = std::process::Command::new("xattr")
                        .arg("-dr")
                        .arg("com.apple.quarantine")
                        .arg(&piper_dir)
                        .output();
                    // Add the piper directory as rpath so @rpath/lib*.dylib resolves.
                    // The binary ships with @rpath references but no LC_RPATH entry —
                    // without this dyld can never locate libespeak-ng, libonnxruntime, etc.
                    for bin in ["piper", "piper_phonemize"] {
                        let bin_path = piper_dir.join(bin);
                        if bin_path.exists() {
                            let _ = std::process::Command::new("install_name_tool")
                                .arg("-add_rpath")
                                .arg(&piper_dir)
                                .arg(&bin_path)
                                .output();
                        }
                    }
                    // Log any still-missing dylibs after extraction for future debugging.
                    for dylib in ["libespeak-ng.1.dylib", "libpiper_phonemize.1.dylib", "libonnxruntime.1.14.1.dylib"] {
                        if !piper_dir.join(dylib).exists() {
                            eprintln!("[yames] WARNING: piper dylib missing after extract: {dylib}");
                        }
                    }
                    // Post-extract smoke test. Only set piper_error
                    // here if no upstream step already failed —
                    // otherwise we'd clobber a more specific error
                    // (e.g. "tar failed extracting") with whatever the
                    // smoke test reports about the symptom downstream.
                    //
                    // Smoke test runs the binary itself rather than
                    // checking filenames, so this is forward-compatible
                    // with future Piper releases that ship a different
                    // set of dylibs/helpers — as long as `piper --help`
                    // runs cleanly the install is considered healthy.
                    if piper_error.is_none() {
                        if let Err(e) = crate::tts::piper_smoke_test(&piper_dir) {
                            eprintln!("[yames] Piper smoke test failed after extract: {e}",);
                            piper_error = Some(e);
                        }
                    }
                }
            }
        }

        // Download voice models
        let voice_dir = models_dir.join("voice");
        let _ = std::fs::create_dir_all(&voice_dir);
        for (voice_id, onnx_url, json_url) in crate::tts::voice_model_urls() {
            let onnx_name = format!("en_US-{voice_id}-medium.onnx");
            let json_name = format!("en_US-{voice_id}-medium.onnx.json");
            let onnx_path = voice_dir.join(&onnx_name);
            let json_path = voice_dir.join(&json_name);
            // Skip only if BOTH files are present AND big enough to be
            // real. Previously this was a `.exists()` check, which let
            // a 1 KB HTML error page (saved by a flaky earlier
            // download) shadow a real redownload — the user got stuck
            // with a "voice present but corrupted" state and no way
            // out except manually deleting the file. Size-gating
            // matches what `tts::list_voices` already does at runtime.
            if voice_already_valid(&onnx_path, &json_path) {
                continue;
            }
            // Wipe any partial/corrupt leftovers so the redownload
            // can't be poisoned by stale bytes mixed with new ones.
            let _ = std::fs::remove_file(&onnx_path);
            let _ = std::fs::remove_file(&json_path);
            if cancel.load(Ordering::Relaxed) {
                let _ = app.emit(
                    "model-download-complete",
                    serde_json::json!({ "success": false, "cancelled": true }),
                );
                return;
            }
            let label = format!("Voice: {voice_id}");
            let _ = app.emit(
                "model-download-progress",
                DownloadProgress {
                    component: label.clone(),
                    downloaded_bytes: 0,
                    total_bytes: 0,
                    fraction: 0.0,
                    done: false,
                },
            );
            // Download .onnx + validate. The size check after curl
            // catches the case where the server returned a 200 + tiny
            // HTML body (CDN error, captive portal, proxy block) which
            // curl happily saves as the "completed" download. Without
            // this, the corrupt file would slip through and the user
            // would hit silence-then-`say`-fallback at first speak.
            if let Err(e) = curl_download(&app, onnx_url, &onnx_path, &cancel, &label) {
                if e == "cancelled" {
                    let _ = app.emit(
                        "model-download-complete",
                        serde_json::json!({ "success": false, "cancelled": true }),
                    );
                    return;
                }
                eprintln!("[yames] Failed to download voice {voice_id}: {e}");
                let _ = app.emit(
                    "model-download-progress",
                    DownloadProgress {
                        component: format!("Voice: {voice_id} (failed: {e})"),
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        fraction: 0.0,
                        done: true,
                    },
                );
                voice_errors.push((voice_id.to_string(), e.clone()));
                continue;
            }
            if let Err(e) = verify_voice_onnx(&onnx_path) {
                eprintln!("[yames] Voice {voice_id} .onnx failed validation: {e}");
                let _ = std::fs::remove_file(&onnx_path);
                let _ = app.emit(
                    "model-download-progress",
                    DownloadProgress {
                        component: format!("Voice: {voice_id} (invalid: {e})"),
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        fraction: 0.0,
                        done: true,
                    },
                );
                voice_errors.push((voice_id.to_string(), e));
                continue;
            }
            // Download .onnx.json sidecar + validate. The sidecar is
            // small (~5 KB) so a truncated 0-byte or 1-byte file is
            // the most common failure; size check still catches it.
            if let Err(e) = curl_download(&app, json_url, &json_path, &cancel, &label) {
                if e == "cancelled" {
                    let _ = app.emit(
                        "model-download-complete",
                        serde_json::json!({ "success": false, "cancelled": true }),
                    );
                    return;
                }
                eprintln!("[yames] Failed to download voice {voice_id} sidecar: {e}");
                // Remove the orphaned .onnx so the next attempt
                // re-downloads both together — otherwise the next run
                // sees a valid .onnx and a missing .json and considers
                // the voice "valid".
                let _ = std::fs::remove_file(&onnx_path);
                voice_errors.push((voice_id.to_string(), format!("sidecar: {e}")));
                continue;
            }
            if let Err(e) = verify_voice_json(&json_path) {
                eprintln!("[yames] Voice {voice_id} .onnx.json failed validation: {e}");
                let _ = std::fs::remove_file(&onnx_path);
                let _ = std::fs::remove_file(&json_path);
                voice_errors.push((voice_id.to_string(), format!("sidecar: {e}")));
                continue;
            }
        }

        // Final state check. Before this was added the function emitted
        // `{ success: true }` unconditionally, which is how the "Practice
        // coach available!" banner showed up even when every curl call
        // had failed (e.g. behind a VPN that blocks HuggingFace) and
        // there were no voice files on disk. Now we surface the real
        // state: if Piper didn't install, that's the headline error; if
        // Piper is fine but one or more voices failed, report the
        // voices. Only when the engine is installed AND at least one
        // voice download succeeded do we emit success.
        // Final engine check — smoke test the binary so the success
        // signal matches reality (binary actually launches, libraries
        // resolve). If an upstream step recorded a specific error
        // already, prefer that; otherwise re-run the smoke test so
        // the error string we emit matches whatever's actually broken.
        let engine_check = crate::tts::piper_smoke_test(&piper_dir);
        if engine_check.is_err() || piper_error.is_some() {
            let err = piper_error
                .or_else(|| engine_check.err())
                .unwrap_or_else(|| "Speech engine install incomplete".to_string());
            let _ = app.emit(
                "model-download-complete",
                serde_json::json!({
                    "success": false,
                    "error": format!("Speech engine couldn't be installed: {err}"),
                }),
            );
            return;
        }
        // Engine smoke test passed. Write the verified marker so hot-path
        // callers (`tts::piper_runnable`, used on every Settings render and
        // every voice-preview click) can trust the install without paying
        // a subprocess on each check. This is the cheap proxy for "we
        // ran `piper --help` and it didn't dyld-crash on this machine".
        let marker = piper_dir.join(crate::tts::PIPER_VERIFIED_MARKER);
        if let Err(e) = std::fs::write(&marker, b"") {
            eprintln!(
                "[yames] Failed to write piper verified marker at {}: {e}",
                marker.display(),
            );
        }
        if !voice_errors.is_empty() {
            let names = voice_errors
                .iter()
                .map(|(v, _)| v.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            let first_err = &voice_errors[0].1;
            let _ = app.emit(
                "model-download-complete",
                serde_json::json!({
                    "success": false,
                    "error": format!("Voice download failed ({names}): {first_err}"),
                }),
            );
            return;
        }
        let _ = app.emit(
            "model-download-complete",
            serde_json::json!({ "success": true, "tier": tier }),
        );
    });
}

/// Download a file with curl. Returns Ok(()) on success.
fn curl_download(
    app: &AppHandle,
    url: &str,
    dest: &std::path::Path,
    cancel: &AtomicBool,
    label: &str,
) -> Result<(), String> {
    use std::process::{Command, Stdio};

    let part_path = dest.with_extension("part");
    let resume = part_path.exists();

    let mut cmd = Command::new("curl");
    cmd.arg("-L")
        .arg("--retry")
        .arg("3")
        .arg("--retry-delay")
        .arg("2")
        .arg("--connect-timeout")
        .arg("15")
        .arg("--max-time")
        .arg("600")
        .arg("--progress-bar")
        .arg("-o")
        .arg(&part_path)
        .arg(url)
        .stderr(Stdio::piped())
        .stdout(Stdio::null());

    // Only use resume if a partial file already exists
    if resume {
        cmd.arg("-C").arg("-");
    }

    eprintln!("[yames] curl_download: url={url} dest={}", dest.display());
    // Log proxy env for debugging
    for var in &["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] {
        if let Ok(val) = std::env::var(var) {
            eprintln!("[yames]   {var}={val}");
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start curl: {e}"))?;
    let stderr = child.stderr.take().unwrap();

    // curl --progress-bar uses \r (carriage return) not \n, so read byte-by-byte
    let mut last_emit = std::time::Instant::now();
    let mut line_buf = String::new();
    let mut reader = std::io::BufReader::new(stderr);
    loop {
        use std::io::Read;
        let mut byte = [0u8; 1];
        match reader.read(&mut byte) {
            Ok(0) => break, // EOF
            Ok(_) => {
                if byte[0] == b'\r' || byte[0] == b'\n' {
                    if !line_buf.is_empty() {
                        if cancel.load(Ordering::Relaxed) {
                            let _ = child.kill();
                            let _ = child.wait();
                            return Err("cancelled".to_string());
                        }
                        if let Some(pct) = parse_curl_progress(&line_buf) {
                            if last_emit.elapsed().as_millis() > 200 {
                                let _ = app.emit(
                                    "model-download-progress",
                                    DownloadProgress {
                                        component: label.to_string(),
                                        downloaded_bytes: 0,
                                        total_bytes: 0,
                                        fraction: pct / 100.0,
                                        done: false,
                                    },
                                );
                                last_emit = std::time::Instant::now();
                            }
                        }
                        line_buf.clear();
                    }
                } else {
                    line_buf.push(byte[0] as char);
                }
            }
            Err(_) => break,
        }
    }

    let status = child.wait().map_err(|e| format!("curl failed: {e}"))?;
    if !status.success() {
        // Clean up partial file on failure
        let _ = std::fs::remove_file(&part_path);
        return Err(format!("curl exited with status {status}"));
    }

    if !part_path.exists() {
        return Err("curl completed but no file was written".to_string());
    }

    std::fs::rename(&part_path, dest).map_err(|e| format!("Failed to rename file: {e}"))?;
    Ok(())
}

fn do_download(
    app: &AppHandle,
    url: &str,
    component: &str,
    filename: &str,
    tier: &str,
    cancel: &AtomicBool,
    label: &str,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?
        .join("models")
        .join(component);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {e}"))?;

    let path = dir.join(filename);
    curl_download(app, url, &path, cancel, label)?;

    // Write the tier marker file
    let tier_path = dir.join("tier");
    std::fs::write(&tier_path, tier).map_err(|e| format!("Failed to write tier: {e}"))?;

    // Final progress event
    let _ = app.emit(
        "model-download-progress",
        DownloadProgress {
            component: label.to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            fraction: 1.0,
            done: true,
        },
    );

    Ok(())
}

// `piper_install_complete` used to live here as a hard-coded list of
// required files (`piper` binary + three dylibs). That schema went
// stale when upstream Piper changed its macOS tarball layout
// (the dylibs are now either statically linked or shipped as helper
// binaries), permanently false-flagging working installs as
// "engine missing — required dylibs missing". The completeness check
// is now `crate::tts::piper_smoke_test`, which probes the engine by
// actually running `piper --help` and looking for dyld errors in
// stderr. Forward-compatible with any future tarball reorg as long
// as the binary still exists and runs.

/// Re-download (or repair) a single voice. Drives the Piper engine
/// install first if it's missing / partial — the engine and the voice
/// files share a directory so a corrupted Piper extraction is what
/// usually masquerades as "voice broken" from the user's POV.
/// Then downloads the voice's `.onnx` + `.onnx.json` sidecar,
/// overwriting any partial/corrupted file already on disk.
///
/// Emits the same `model-download-progress` / `model-download-complete`
/// events as the full `start_download` so the existing UI works
/// unchanged. The complete event omits `tier` so the frontend's
/// "tier completed" branch doesn't false-fire — a repair leaves the
/// active brain tier untouched.
pub fn start_voice_repair(app: AppHandle, voice_id: String, cancel: DownloadCancelFlag) {
    std::thread::spawn(move || {
        let models_dir = match app.path().app_data_dir() {
            Ok(d) => d.join("models"),
            Err(e) => {
                let _ = app.emit(
                    "model-download-complete",
                    serde_json::json!({ "success": false, "error": format!("{e}") }),
                );
                return;
            }
        };

        // Step 1: Piper engine. The "robotic voice / no audio" bug
        // user reports almost always trace back to a partial tarball
        // extraction, not a missing voice file — so the repair path
        // re-extracts the engine first, then the voice. The wipe-before-
        // extract is what fixed the user's case on 2026-05-18 (orphan
        // `piper` binary on disk, all three dylibs missing).
        let piper_dir = models_dir.join("piper");
        if crate::tts::piper_smoke_test(&piper_dir).is_err() {
            let _ = app.emit(
                "model-download-progress",
                DownloadProgress {
                    component: "Piper TTS engine".to_string(),
                    downloaded_bytes: 0,
                    total_bytes: 0,
                    fraction: 0.0,
                    done: false,
                },
            );
            if piper_dir.exists() {
                if let Err(e) = std::fs::remove_dir_all(&piper_dir) {
                    eprintln!("[yames] start_voice_repair: failed to remove stale piper/: {e}");
                }
            }
            let piper_url = crate::tts::piper_binary_url();
            let tar_path = models_dir.join("piper.tar.gz");
            if let Err(e) = curl_download(&app, piper_url, &tar_path, &cancel, "Piper TTS engine") {
                if e == "cancelled" {
                    let _ = app.emit(
                        "model-download-complete",
                        serde_json::json!({ "success": false, "cancelled": true }),
                    );
                    return;
                }
                let _ = app.emit(
                    "model-download-complete",
                    serde_json::json!({ "success": false, "error": format!("Piper engine: {e}") }),
                );
                return;
            }
            // Sanity-check tarball size — see start_download for the
            // full rationale (HuggingFace / proxy / VPN-intercept can
            // serve a tiny error page in place of the real ~24 MB
            // tarball). 15 MB floor catches everything spurious.
            const MIN_PIPER_TARBALL_BYTES: u64 = 15 * 1024 * 1024;
            let tar_size = std::fs::metadata(&tar_path).map(|m| m.len()).unwrap_or(0);
            if tar_size < MIN_PIPER_TARBALL_BYTES {
                let _ = std::fs::remove_file(&tar_path);
                let _ = app.emit(
                    "model-download-complete",
                    serde_json::json!({
                        "success": false,
                        "error": format!(
                            "Piper engine archive is only {tar_size} bytes (expected at least {} MB) \u{2014} download may be corrupted or intercepted",
                            MIN_PIPER_TARBALL_BYTES / (1024 * 1024),
                        ),
                    }),
                );
                return;
            }
            let _ = std::fs::create_dir_all(&models_dir);
            let extract = std::process::Command::new("tar")
                .arg("xzf")
                .arg(&tar_path)
                .arg("-C")
                .arg(&models_dir)
                .output();
            let _ = std::fs::remove_file(&tar_path);
            // Capture tar failure explicitly so the UI shows the real
            // root cause (e.g. "gzip: stdin: not in gzip format") rather
            // than the generic downstream smoke-test failure.
            match extract {
                Ok(out) if !out.status.success() => {
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    let _ = app.emit(
                        "model-download-complete",
                        serde_json::json!({
                            "success": false,
                            "error": format!("tar failed extracting Piper: {stderr}"),
                        }),
                    );
                    return;
                }
                Err(e) => {
                    let _ = app.emit(
                        "model-download-complete",
                        serde_json::json!({
                            "success": false,
                            "error": format!("failed to run tar: {e}"),
                        }),
                    );
                    return;
                }
                _ => {}
            }
            // Strip macOS Gatekeeper quarantine xattr from the freshly-
            // extracted tree. Parity with `start_download` — without this
            // the dylibs Piper loads at startup can be silently blocked
            // by Gatekeeper even though the files exist, producing the
            // "Library not loaded: @rpath/libespeak-ng.1.dylib" failure
            // mode the 2026-05-18 user hit. Errors are ignored because
            // `xattr` exits non-zero when the attribute isn't set —
            // which is exactly the case we want.
            let _ = std::process::Command::new("xattr")
                .arg("-dr")
                .arg("com.apple.quarantine")
                .arg(&piper_dir)
                .output();
            // Add the piper directory as rpath so @rpath/lib*.dylib resolves.
            // The binary ships with @rpath references but no LC_RPATH entry —
            // without this dyld can never locate libespeak-ng, libonnxruntime, etc.
            for bin in ["piper", "piper_phonemize"] {
                let bin_path = piper_dir.join(bin);
                if bin_path.exists() {
                    let _ = std::process::Command::new("install_name_tool")
                        .arg("-add_rpath")
                        .arg(&piper_dir)
                        .arg(&bin_path)
                        .output();
                }
            }
            // Log any still-missing dylibs after extraction for future debugging.
            for dylib in ["libespeak-ng.1.dylib", "libpiper_phonemize.1.dylib", "libonnxruntime.1.14.1.dylib"] {
                if !piper_dir.join(dylib).exists() {
                    eprintln!("[yames] WARNING: piper dylib missing after extract: {dylib}");
                }
            }
            if let Err(e) = crate::tts::piper_smoke_test(&piper_dir) {
                let _ = app.emit(
                    "model-download-complete",
                    serde_json::json!({
                        "success": false,
                        "error": format!("Piper engine extracted but failed smoke test: {e}"),
                    }),
                );
                return;
            }
            // Smoke test passed — write the verified marker so the hot-
            // path `piper_runnable` check sees a healthy install and
            // the UI advertises voices as ready. See the matching write
            // in `start_download` for the full rationale.
            let marker = piper_dir.join(crate::tts::PIPER_VERIFIED_MARKER);
            if let Err(e) = std::fs::write(&marker, b"") {
                eprintln!(
                    "[yames] Failed to write piper verified marker at {}: {e}",
                    marker.display(),
                );
            }
        }

        // Step 2: the named voice. Look up its URLs against the
        // catalog; an unknown id is a programmer error from the
        // frontend, surface it as a complete-event with `success:false`
        // rather than silently no-op so the UI banner reads correctly.
        let voice_entry = crate::tts::voice_model_urls()
            .into_iter()
            .find(|(id, _, _)| *id == voice_id);
        let (id_str, onnx_url, json_url) = match voice_entry {
            Some(v) => (v.0.to_string(), v.1.to_string(), v.2.to_string()),
            None => {
                let _ = app.emit(
                    "model-download-complete",
                    serde_json::json!({
                        "success": false,
                        "error": format!("Unknown voice id: {voice_id}"),
                    }),
                );
                return;
            }
        };

        let voice_dir = models_dir.join("voice");
        let _ = std::fs::create_dir_all(&voice_dir);
        let onnx_path = voice_dir.join(format!("en_US-{id_str}-medium.onnx"));
        let json_path = voice_dir.join(format!("en_US-{id_str}-medium.onnx.json"));

        // ALWAYS remove any existing file first. The repair path is the
        // user's "this voice is corrupted" escape hatch — silently
        // skipping because a too-small file already exists would defeat
        // the whole point.
        let _ = std::fs::remove_file(&onnx_path);
        let _ = std::fs::remove_file(&json_path);

        let label = format!("Voice: {id_str}");
        let _ = app.emit(
            "model-download-progress",
            DownloadProgress {
                component: label.clone(),
                downloaded_bytes: 0,
                total_bytes: 0,
                fraction: 0.0,
                done: false,
            },
        );
        if let Err(e) = curl_download(&app, &onnx_url, &onnx_path, &cancel, &label) {
            if e == "cancelled" {
                let _ = app.emit(
                    "model-download-complete",
                    serde_json::json!({ "success": false, "cancelled": true }),
                );
                return;
            }
            let _ = app.emit(
                "model-download-complete",
                serde_json::json!({ "success": false, "error": format!("Voice {id_str}: {e}") }),
            );
            return;
        }
        // Size-validate the .onnx. Same rationale as the bulk
        // pipeline: catches CDN error pages saved as 200 OK, partial
        // truncations, and proxy-stripped bodies.
        if let Err(e) = verify_voice_onnx(&onnx_path) {
            let _ = std::fs::remove_file(&onnx_path);
            let _ = app.emit(
                "model-download-complete",
                serde_json::json!({
                    "success": false,
                    "error": format!("Voice {id_str} appears corrupt: {e}"),
                }),
            );
            return;
        }
        if let Err(e) = curl_download(&app, &json_url, &json_path, &cancel, &label) {
            if e == "cancelled" {
                let _ = app.emit(
                    "model-download-complete",
                    serde_json::json!({ "success": false, "cancelled": true }),
                );
                return;
            }
            // Sidecar failure is unusual — the file is ~5 KB — but
            // surface it as an error rather than partial success so the
            // UI can prompt a retry. Also wipe the orphaned .onnx so a
            // subsequent run doesn't see a half-installed voice.
            let _ = std::fs::remove_file(&onnx_path);
            let _ = app.emit(
                "model-download-complete",
                serde_json::json!({ "success": false, "error": format!("Voice {id_str} sidecar: {e}") }),
            );
            return;
        }
        if let Err(e) = verify_voice_json(&json_path) {
            let _ = std::fs::remove_file(&onnx_path);
            let _ = std::fs::remove_file(&json_path);
            let _ = app.emit(
                "model-download-complete",
                serde_json::json!({
                    "success": false,
                    "error": format!("Voice {id_str} sidecar appears corrupt: {e}"),
                }),
            );
            return;
        }

        // Done. Omit `tier` so the JS layer's "tier completed" branch
        // doesn't fire and clobber the active brain selection.
        let _ = app.emit(
            "model-download-complete",
            serde_json::json!({ "success": true }),
        );
    });
}

/// True when both files of a Piper voice pair (`.onnx` model + JSON
/// sidecar) exist on disk AND are big enough to be the real assets.
/// Matches the same thresholds the runtime diagnostics path uses, so
/// the installer and `tts::list_voices` agree on what "voice present"
/// means.
///
/// Falls back to "not valid" on any metadata error so callers can
/// trigger a clean redownload — the safer side to err on when the
/// alternative is letting a 1 KB error page masquerade as a 60 MB
/// neural voice model.
fn voice_already_valid(onnx: &std::path::Path, json: &std::path::Path) -> bool {
    let onnx_ok = std::fs::metadata(onnx)
        .map(|m| m.len() >= crate::tts::MIN_ONNX_BYTES)
        .unwrap_or(false);
    let json_ok = std::fs::metadata(json)
        .map(|m| m.len() >= crate::tts::MIN_ONNX_JSON_BYTES)
        .unwrap_or(false);
    onnx_ok && json_ok
}

/// Validate a freshly-downloaded Piper voice `.onnx` file. Real Piper
/// medium models weigh ~60 MB on disk; we floor at `MIN_ONNX_BYTES`
/// (30 MB) so the check is tolerant to future minor size shifts but
/// still catches the common failure modes:
///
///   * Server returned 200 + an HTML error / captive portal page
///     (typically a few KB)
///   * Connection dropped midway through and curl saved the partial
///   * A corporate proxy stripped the body entirely
///
/// Returns Ok if the file looks big enough to be the real model;
/// otherwise an error string suitable for the user-facing banner.
fn verify_voice_onnx(path: &std::path::Path) -> Result<(), String> {
    let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if bytes < crate::tts::MIN_ONNX_BYTES {
        Err(format!(
            "downloaded .onnx is only {bytes} bytes (expected at least {} MB)",
            crate::tts::MIN_ONNX_BYTES / (1024 * 1024),
        ))
    } else {
        Ok(())
    }
}

/// Validate a freshly-downloaded Piper voice `.onnx.json` sidecar.
/// Real sidecars are ~5 KB of JSON; the 1 KB floor (`MIN_ONNX_JSON_BYTES`)
/// catches truncated or empty-body failures without false-flagging
/// legitimate future config slimming.
fn verify_voice_json(path: &std::path::Path) -> Result<(), String> {
    let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if bytes < crate::tts::MIN_ONNX_JSON_BYTES {
        Err(format!(
            "downloaded sidecar is only {bytes} bytes (expected at least {})",
            crate::tts::MIN_ONNX_JSON_BYTES,
        ))
    } else {
        Ok(())
    }
}

/// Parse percentage from curl progress bar output.
/// curl --progress-bar outputs lines like "###                         5.2%"
fn parse_curl_progress(line: &str) -> Option<f64> {
    let trimmed = line.trim();
    // Look for a percentage at the end of the line
    if let Some(pos) = trimmed.rfind('%') {
        // Walk backwards to find the start of the number
        let before = &trimmed[..pos];
        let num_start = before
            .rfind(|c: char| !c.is_ascii_digit() && c != '.')
            .map(|i| i + 1)
            .unwrap_or(0);
        before[num_start..].parse::<f64>().ok()
    } else {
        None
    }
}
