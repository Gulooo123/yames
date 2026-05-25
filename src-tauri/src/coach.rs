//! Practice Coach — LLM inference engine.
//!
//! When built with the `coach-llm` feature, loads a GGUF model from disk and
//! runs text generation for coaching comments, mini-reports, session summaries,
//! and chat Q&A. Without the feature, generates template-based responses.

use std::sync::{Arc, Mutex};

/// Thread-safe handle to the coach engine.
pub type SharedCoachEngine = Arc<Mutex<CoachEngine>>;

pub fn create_shared_engine() -> SharedCoachEngine {
    Arc::new(Mutex::new(CoachEngine::new()))
}

// ---------------------------------------------------------------------------
// Template-based engine (always available)
// ---------------------------------------------------------------------------

pub struct CoachEngine {
    #[cfg(feature = "coach-llm")]
    model: Option<LlmModel>,
    loaded: bool,
}

impl CoachEngine {
    pub fn new() -> Self {
        CoachEngine {
            #[cfg(feature = "coach-llm")]
            model: None,
            loaded: false,
        }
    }

    pub fn is_loaded(&self) -> bool {
        self.loaded
    }
}

/// System prompt that constrains the coach's behavior.
/// Only referenced when the `coach-llm` feature is enabled (the
/// inner `llm` module reaches for `super::SYSTEM_PROMPT` when building
/// the prompt).  Tagged `dead_code`-allowed on the no-LLM path so the
/// default-features build stays warning-clean.
#[cfg_attr(not(feature = "coach-llm"), allow(dead_code))]
pub const SYSTEM_PROMPT: &str = r#"You are a practice coach for a metronome app. You help musicians improve their timing and rhythm.

Rules:
- Keep responses concise (1-3 sentences max)
- Only discuss timing, rhythm, practice, and the session data you're given
- Be encouraging but honest about areas to improve
- Never make up data — only reference metrics provided to you
- Use natural, conversational language like a supportive instructor
- When commenting on timing: "early" means ahead of the beat, "late" means behind
- Reference specific beats or patterns when the data supports it"#;

/// Load the GGUF model from the brain directory.
pub fn load_model(engine: &mut CoachEngine, model_path: &std::path::Path) -> Result<bool, String> {
    if !model_path.exists() {
        return Ok(false);
    }

    #[cfg(feature = "coach-llm")]
    {
        let llm = LlmModel::load(model_path)?;
        engine.model = Some(llm);
        engine.loaded = true;
        return Ok(true);
    }

    #[cfg(not(feature = "coach-llm"))]
    {
        // Mark as loaded so template-based mode activates
        let _ = model_path;
        engine.loaded = true;
        Ok(true)
    }
}

/// Generate a coaching comment from structured DSP data.
///
/// On the `coach-llm` path `engine.model` is the actual LLM handle.
/// On the default (no-LLM) path the engine carries no state but the
/// parameter is kept symmetric so callers don't have to feature-gate
/// the call site — the underscore prefix silences the unused-var
/// warning in that build.
#[cfg_attr(not(feature = "coach-llm"), allow(unused_variables))]
pub fn generate(engine: &CoachEngine, context: &str) -> Result<String, String> {
    #[cfg(feature = "coach-llm")]
    if let Some(ref model) = engine.model {
        return model.generate(context);
    }

    // Template-based fallback
    generate_template(context)
}

/// Template-based generation — parses the structured context and produces a response.
fn generate_template(context: &str) -> Result<String, String> {
    // Parse key metrics from the context string
    let accuracy = extract_metric(context, "Accuracy:").unwrap_or(0.0);
    // `SignedDev:` is a dedicated parseable line added by the JS context
    // builder (miniReport.ts). The old "avg" key tried to extract from the
    // human-readable "Timing spread: avg ±8.1ms" line — but "±8.1ms" has a
    // ± prefix and "ms" suffix that defeat `parse::<f64>()`, so deviation
    // always resolved to 0.0 and the template always reported "right in the
    // pocket" regardless of actual timing. `SignedDev:` is plain digits only.
    let deviation = extract_metric(context, "SignedDev:")
        .unwrap_or_else(|| extract_metric(context, "avg").unwrap_or(0.0));
    // Hit completeness — what fraction of expected subdivision positions had
    // a matched onset. Low values (< 0.50) explain why a well-timed player
    // can still score in the 40s: they're playing phrases, not every slot.
    // Falls back to 1.0 (assume full coverage) if the field isn't present.
    let hit_completeness = extract_metric(context, "HitCompleteness:").unwrap_or(1.0);
    let streak = extract_int(context, "Longest clean streak:").unwrap_or(0);
    // The mini-report card shows a `ScoreRing` with the composite
    // four-component score adjacent to the coach text. Surfacing the
    // accuracy percent (`hits / (hits + miss)`) as the headline number
    // in the template caused user-visible confusion in v0.9 — the
    // circle would read "65" while the text said "Rough patch at 50%"
    // and the two metrics looked contradictory. We now lead with the
    // score so the text and the badge agree; accuracy still appears
    // but as a secondary detail.
    let score = extract_int(context, "Score:").unwrap_or(0);

    let is_summary = context.contains("ended their practice session");
    let is_chat = context.contains("User asks:");
    // The JS side sends greetings as a `"Rephrase this practice-coach
    // greeting..."` prompt with the rendered template embedded under
    // `Original: "..."`. Match on that stable phrase so we recognise
    // greetings regardless of whether the player has a preset, history,
    // or is on the cold path.
    let is_greeting = context.contains("practice-coach greeting");
    // Real-time tips also arrive as a `"Rephrase this practice-coach
    // observation..."` prompt with the gatekeeper-filled template
    // under `Original: "..."`. Without this branch the rephrase falls
    // through to `format_mini_report` — and since the rephrase prompt
    // carries neither `Score:` nor `Accuracy:` fields, both extracts
    // return 0 and the coach-tip lands as a hard-coded "Score 0 —
    // right in the pocket. Ease the tempo down…" no matter what the
    // gatekeeper actually said. We treat the template-fallback path
    // for rephrases the same way as greetings: return the Original
    // verbatim (the JS template is fully shippable without LLM help).
    let is_rephrase_observation =
        context.contains("Rephrase this practice-coach observation");

    if is_chat {
        // Extract the question
        let question = context
            .lines()
            .find(|l| l.starts_with("User asks:"))
            .map(|l| l.trim_start_matches("User asks:").trim())
            .unwrap_or("");

        return Ok(format_chat_response(question, accuracy, deviation));
    }

    if is_greeting {
        return Ok(format_greeting(context));
    }

    if is_rephrase_observation {
        return Ok(format_rephrase_observation(context));
    }

    if is_summary {
        return Ok(format_session_summary(accuracy, deviation, streak));
    }

    // Mini-report
    let ic = extract_metric(context, "IC:").unwrap_or(0.5);
    let ga = extract_metric(context, "GA:").unwrap_or(0.5);
    let burst_count = extract_int(context, "BurstCount:").unwrap_or(0);
    let is_burst = burst_count >= 3;

    let mut comment = format_mini_report(score, accuracy, deviation, streak, hit_completeness);
    if is_burst && ga < 0.65 && ic > ga + 0.1 {
        comment.push_str(" Re-entries are pulling the grid score down — focus on locking the first note of each phrase.");
    }
    Ok(comment)
}

/// Template-fallback for the real-time rephrase prompt.
///
/// The JS-side gatekeeper has already filled a scenario-specific
/// template (e.g. "{recentAccuracyPct}% — your kick is drifting.
/// Lock the right foot to the click before the snare.") and embedded
/// it under `Original: "..."`. Without an LLM we can't actually
/// paraphrase, but the template is fully self-sufficient — return it
/// verbatim so the coach voices the gatekeeper's intent rather than a
/// generic mini-report placeholder.
///
/// Falls back to a short defensive opener if the Original block is
/// missing (shouldn't happen — `buildRephrasePrompt` always emits one).
fn format_rephrase_observation(context: &str) -> String {
    if let Some(original) = extract_original_quote(context) {
        return original;
    }
    "Keep going — locked in on the click.".to_string()
}

/// Render a fallback greeting when the LLM rephrase isn't available.
///
/// The JS side already produced a context-aware, history-aware greeting
/// (preset name, last score, target, downtrend handling, etc.) and
/// embeds it in the rephrase prompt as `Original: "..."`. Without an
/// LLM we can't actually rephrase, but the JS template is fully shippable
/// on its own — return it verbatim so the user sees the same warm,
/// specific message they'd get from the LLM.
///
/// If we can't find an `Original: "..."` block we fall through to a
/// short, friendly default rather than the prior "Free practice — play
/// when you're ready..." which felt too cold.
fn format_greeting(context: &str) -> String {
    if let Some(original) = extract_original_quote(context) {
        return original;
    }
    // No Original block — emit a warm, generic opener. This branch
    // shouldn't normally fire (the JS rephrase prompt always includes
    // Original) but is defensive against future prompt-format drift.
    "Hey — ready when you are. Hit play and I'll start picking up your timing.".to_string()
}

/// Extract the text inside the first `Original: "..."` block of the
/// rephrase prompt. Returns None if the marker isn't present.
fn extract_original_quote(context: &str) -> Option<String> {
    let start = context.find("Original: \"")?;
    let rest = &context[start + "Original: \"".len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// Score-first mini-report template.
///
/// `score` is the composite four-component segment score (the same
/// number shown in the `ScoreRing` adjacent to this text). Branching
/// on `score` rather than `accuracy` means the wording reinforces the
/// badge instead of contradicting it: a 65-score segment never reads
/// as "Rough patch at 50%" again.
///
/// Accuracy still appears as a secondary detail in the mid-tier
/// branches because it's the clearest "how many beats did you land"
/// signal — just clearly labelled (`{accuracy}% hits`) so it doesn't
/// look like a competing headline.
fn format_mini_report(score: u32, _accuracy: f64, deviation: f64, streak: u32, hit_completeness: f64) -> String {
    let timing = if deviation.abs() < 5.0 {
        "right in the pocket"
    } else if deviation < -5.0 {
        "slightly ahead of the beat"
    } else {
        "slightly behind the beat"
    };

    if score >= 85 {
        if streak >= 16 {
            format!("Score {score} — solid run, {timing}. {streak}-beat clean streak, nice consistency.")
        } else {
            format!("Score {score} — locked in, {timing}. Keep pushing for longer clean streaks.")
        }
    } else if score >= 65 {
        if streak >= 8 {
            format!("Score {score} — {timing}. {streak}-beat clean run; tighten the feel on re-entries.")
        } else {
            format!("Score {score} — {timing}. Keep phrases tighter and aim for longer clean streaks.")
        }
    } else {
        // Score < 65. Two distinct cases:
        //   (a) Timing is off → tempo advice makes sense.
        //   (b) Timing is solid but score is low → the issue is beat
        //       coverage or grid alignment, NOT tempo. Telling a player
        //       who is already "right in the pocket" to "ease the tempo
        //       down" is contradictory and condescending — fixed here.
        if timing == "right in the pocket" {
            let pct = (hit_completeness * 100.0).round() as u32;
            if pct < 50 {
                // Low coverage — player is hitting phrases, not filling
                // every subdivision. Name the actual issue.
                format!("Score {score} — timing center is solid but only {pct}% of beats are filled. Focus on groove density.")
            } else {
                format!("Score {score} — right in the pocket. Focus on consistency through the full phrase.")
            }
        } else {
            // Timing IS drifting — a tempo adjustment is appropriate.
            format!("Score {score} — {timing}. Ease the tempo down a touch and rebuild from a clean bar.")
        }
    }
}

fn format_session_summary(accuracy: f64, deviation: f64, streak: u32) -> String {
    let tendency = if deviation.abs() < 3.0 {
        "centered timing"
    } else if deviation < 0.0 {
        "a slight rush"
    } else {
        "a slight drag"
    };

    // v0.10: the low-accuracy branch used to open with "Tough
    // session…" which read as a verdict. This is a practice tool, not
    // an exam — and a low accuracy reading is often a detection-
    // sensitivity issue (under-counted onsets), not a "tough session."
    // Reframed all three branches to lead with what's worth carrying
    // forward instead of what fell short. The accuracy ladder still
    // dispatches on the same thresholds so the wording tracks reality.
    if accuracy >= 85.0 {
        format!(
            "Locked in — {accuracy:.0}% accuracy with {tendency}. \
             Best streak was {streak} beats. Try nudging the tempo up next time."
        )
    } else if accuracy >= 60.0 {
        format!(
            "Good session — {accuracy:.0}% accuracy with {tendency}. \
             Pick one passage that felt off and run it a few more times."
        )
    } else {
        format!(
            "Plenty to build on — {tendency} with a {streak}-beat best streak. \
             Try dropping the tempo a touch and locking in a clean bar."
        )
    }
}

fn format_chat_response(question: &str, accuracy: f64, deviation: f64) -> String {
    let q = question.to_lowercase();
    if q.contains("timing") || q.contains("how was") || q.contains("how did") {
        let timing = if deviation.abs() < 5.0 {
            "Your timing was solid — pretty centered on the beat."
        } else if deviation < 0.0 {
            "You were pushing slightly ahead of the beat on average."
        } else {
            "You were sitting slightly behind the beat on average."
        };
        format!("{timing} Overall accuracy was {accuracy:.0}%.")
    } else if q.contains("focus") || q.contains("improve") || q.contains("work on") {
        if deviation.abs() > 10.0 {
            "Focus on locking in with the click — your timing is drifting. Try a slower tempo and nail the pocket.".to_string()
        } else if accuracy < 80.0 {
            "Work on clean hits at this tempo before pushing faster. Accuracy first, speed second.".to_string()
        } else {
            "You're in good shape. Try pushing the tempo up 5 BPM and see if you can maintain this accuracy.".to_string()
        }
    } else {
        format!("Your session shows {accuracy:.0}% accuracy with an average deviation of {deviation:.1}ms. Keep at it!")
    }
}

fn extract_metric(text: &str, prefix: &str) -> Option<f64> {
    text.lines()
        .find(|l| l.contains(prefix))
        .and_then(|l| {
            l.split_whitespace()
                .find_map(|w| w.trim_end_matches('%').parse::<f64>().ok())
        })
}

fn extract_int(text: &str, prefix: &str) -> Option<u32> {
    text.lines()
        .find(|l| l.contains(prefix))
        .and_then(|l| {
            let after = l.split(prefix).nth(1)?;
            after.split_whitespace()
                .next()?
                .parse::<u32>()
                .ok()
        })
}

// NOTE: `format_mini_report_context`, `format_session_summary_context`,
// and `format_chat_context` used to live here as Rust-side formatters
// for the LLM prompt. The JS layer now owns prompt assembly in
// `src/hooks/useSession.ts` (`formatMiniReportContext`,
// `formatSessionContext`, the chat literal in `sendChat`) — keeping
// the formatting on the side that also owns gatekeeper context and
// narrative state means there is exactly one source of truth for
// "what goes into the LLM." Removed during the Step-4 house-cleaning
// pass after they sat dead since the Phase-5 refactor.

// ---------------------------------------------------------------------------
// LLM backend (only compiled with coach-llm feature)
// ---------------------------------------------------------------------------

#[cfg(feature = "coach-llm")]
mod llm {
    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::LlamaModel;
    use llama_cpp_2::sampling::LlamaSampler;

    const MAX_TOKENS: usize = 256;
    const CONTEXT_SIZE: u32 = 2048;

    pub struct LlmModel {
        backend: LlamaBackend,
        model: LlamaModel,
    }

    impl LlmModel {
        pub fn load(path: &std::path::Path) -> Result<Self, String> {
            let backend = LlamaBackend::init()
                .map_err(|e| format!("Failed to init llama backend: {e}"))?;
            let params = LlamaModelParams::default();
            let model = LlamaModel::load_from_file(&backend, path, &params)
                .map_err(|e| format!("Failed to load model: {e}"))?;
            Ok(LlmModel { backend, model })
        }

        pub fn generate(&self, context: &str) -> Result<String, String> {
            let prompt = format!(
                "<|system|>\n{}<|end|>\n<|user|>\n{context}<|end|>\n<|assistant|>\n",
                super::SYSTEM_PROMPT,
            );

            let ctx_params = LlamaContextParams::default()
                .with_n_ctx(std::num::NonZero::new(CONTEXT_SIZE));
            let mut ctx = self.model.new_context(&self.backend, ctx_params)
                .map_err(|e| format!("Context creation failed: {e}"))?;

            let tokens = self.model
                .str_to_token(&prompt, llama_cpp_2::model::AddBos::Always)
                .map_err(|e| format!("Tokenization failed: {e}"))?;

            if tokens.len() >= CONTEXT_SIZE as usize {
                return Err("Prompt too long for context window".into());
            }

            let mut batch = LlamaBatch::new(CONTEXT_SIZE as usize, 1);
            for (i, &token) in tokens.iter().enumerate() {
                let is_last = i == tokens.len() - 1;
                batch.add(token, i as i32, &[0], is_last)
                    .map_err(|e| format!("Batch add failed: {e}"))?;
            }

            ctx.decode(&mut batch)
                .map_err(|e| format!("Decode failed: {e}"))?;

            let mut output_tokens = Vec::new();
            let mut sampler = LlamaSampler::chain_simple([
                LlamaSampler::temp(0.7),
                LlamaSampler::top_p(0.9, 1),
                LlamaSampler::dist(42),
            ]);

            for _ in 0..MAX_TOKENS {
                let logits_id = batch.n_tokens() - 1;
                let token = sampler.sample(&ctx, logits_id);

                if self.model.is_eog_token(token) {
                    break;
                }

                output_tokens.push(token);

                batch.clear();
                batch.add(
                    token,
                    tokens.len() as i32 + output_tokens.len() as i32 - 1,
                    &[0],
                    true,
                ).map_err(|e| format!("Batch add failed: {e}"))?;

                ctx.decode(&mut batch)
                    .map_err(|e| format!("Decode failed: {e}"))?;
            }

            let mut result = String::new();
            for token in &output_tokens {
                let piece = self.model
                    .token_to_str(*token, llama_cpp_2::token::LlamaTokenAttr::all())
                    .map_err(|e| format!("Token decode failed: {e}"))?;
                result.push_str(&piece);
            }

            Ok(result.trim().to_string())
        }
    }
}

#[cfg(feature = "coach-llm")]
use llm::LlmModel;
