\documentclass[11pt, a4paper]{article}

% --- UNIVERSAL PREAMBLE BLOCK ---
\usepackage[a4paper, top=2.5cm, bottom=2.5cm, left=2cm, right=2cm]{geometry}
\usepackage{fontspec}
\usepackage[english, bidi=basic, provide=*]{babel}

\babelprovide[import, onchar=ids fonts]{english}

% Set default/Latin font to Sans Serif (Noto Sans)
\babelfont{rm}{Noto Sans}

% Support for lists
\usepackage{enumitem}
\setlist[itemize]{label=-}
% --------------------------------

\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{booktabs}
\usepackage{titlesec}
\usepackage{xcolor}
\usepackage{array}

\titleformat{\section}{\Large\bfseries\color{black}}{\thesection}{1em}{}[{\titlerule[0.5pt]}]
\titleformat{\subsection}{\large\bfseries}{\thesubsection}{1em}{}

\title{Technical Audit and Critical Implementation Review: yames DSP Scoring Pipeline and AI Practice Coach}
\author{Implementation Review Board}
\date{May 15, 2026}

\begin{document}

\maketitle

\begin{abstract}
The architectural evolution of the yames application—a desktop-based metronome and practice coach leveraging a Tauri 2 and Rust backend—represents a significant attempt to meld deterministic digital signal processing (DSP) with generative artificial intelligence. This report provides a detailed examination of phases D1 through D4 (scoring pipeline) and C1 through C5 (coaching engine). We identify unvalidated assumptions, critical edge cases, and structural contradictions that may compromise utility for professional musicians.
\end{abstract}

\section{Phase D1: Latency Calibration and System-Level Stability}

Phase D1 focuses on synchronizing the metronome's internal clock with physical audio capture. The plan assumes a static one-time calibration is sufficient. However, desktop audio architectures in 2026 exhibit significant jitter and drift.

\subsection{Architectural Jitter and Driver-Induced Latency}

Using `cpal` for WASAPI (Windows) or CoreAudio (macOS) provides abstraction, but system-level mixing buffers add variable delay. Total round-trip latency remains heavily dependent on hardware driver implementation.

\begin{table}[htbp]
\centering
\caption{Latency heuristics as a function of buffer size and sampling rate.}
\begin{tabular}{@{}llll@{}}
\toprule
Buffer Size & Latency @ 44.1 kHz & Latency @ 48 kHz & Risk Profile \\ \midrule
64 & $\sim$1.45 ms & $\sim$1.33 ms & High Glitch Risk \\
128 & $\sim$2.90 ms & $\sim$2.67 ms & Low-Latency Standard \\
256 & $\sim$5.80 ms & $\sim$5.33 ms & Stability Baseline \\
512 & $\sim$11.6 ms & $\sim$10.7 ms & Safe Baseline \\ \bottomrule
\end{tabular}
\end{table}

\textbf{Recommendation:} Implement \textit{Continuous Statistical Alignment}. By analyzing onset distributions over several measures, the system can determine a "mean offset" relative to the grid and adjust compensation dynamically to account for system drift.

\section{Phase D2: Onset Detection and the Refractory Trap}

Phase D2 implements an improved onset detection function (ODF) using spectral flux:
$$\Delta Spectral(n) = \sum_{k=0}^{K} H(|X(n, k)| - |X(n-1, k)|)$$
where $H(x) = \frac{x + |x|}{2}$ is half-wave rectification.

\subsection{The 20 ms Refractory Period Problem}
The proposed 20 ms refractory period is insufficient for high-level techniques like drum flams or piano trills, where inter-onset intervals (IOI) frequently fall between 15 ms and 45 ms.

\begin{table}[htbp]
\centering
\caption{Comparison of minimum inter-onset intervals (IOI).}
\begin{tabular}{@{}llll@{}}
\toprule
Technique & Typical IOI (ms) & Target Res (ms) & Hazard \\ \midrule
Drum Flam & 17 - 45 & 1.0 & Note Merging \\
Drum Drag & 30 - 60 & 1.0 & Spurious Trigger \\
Piano Trill & 15 - 30 & 2.0 & Harmonic Masking \\
16th (200 BPM) & 75 & 5.0 & Grid Displacement \\ \bottomrule
\end{tabular}
\end{table}

\section{Phase D3: Critical Evaluation of the Scoring Formula}

The current proposal defines: $Total\_Score = (Acc \times 0.6) + (Cons \times 0.4)$.

\subsection{Accuracy vs. Consistency}
Consistency (rhythmic stability) is pedagogically more important than absolute grid alignment (accuracy). A student who is consistently 15 ms late has a functioning internal clock; a student with high jitter does not. We recommend a $70/30$ weighting in favor of consistency.

\subsection{Formula Gameability}
The current formula is vulnerable to "mashing." We recommend the $F_1$ measure:
$$F_1 = \frac{2 \cdot Precision \cdot Recall}{Precision + Recall}$$

\section{AI Practice Coach: Phases C1--C5}

\subsection{Inference Interference}
Running a local LLM concurrently with high-priority audio threads can cause DPC latency spikes.

\begin{table}[htbp]
\centering
\caption{2026 Local LLM Benchmarks.}
\begin{tabular}{@{}llll@{}}
\toprule
Hardware & Model Recommendation & Generation (tok/s) & Thermal Impact \\ \midrule
M4 Max & Qwen 3.5 (235B Q4) & 5 - 15 & High \\
RTX 4070 & Phi-4 (14B Q4) & 20 - 40 & Moderate \\
M2 Air & Phi-4 Mini (3.8B Q4) & 10 - 25 & Low \\ \bottomrule
\end{tabular}
\end{table}

\section{Critical Implementation Red Flags}

\begin{enumerate}
\item \textbf{D2 Refractory Window:} 20 ms constant will merge flams/trills.
\item \textbf{D3c Fixed Weights:} $60/40$ accuracy-primary penalizes stylistic "groove."
\item \textbf{C1/C2 Concurrent Inference:} Causes audio stuttering on mid-range hardware.
\item \textbf{D3b Efficiency Metric:} Simple ratios are gameable; needs $F_1$ measure.
\item \textbf{Visualization Lag:} Standard React state updates add $\sim$20 ms of visual delay.
\end{enumerate}

\appendix
\section{Technical Appendix: Scoring Mathematics}

\textbf{Median Absolute Deviation (MAD):}
$$MAD = \text{median}(|x_i - \text{median}(X)|)$$
This metric is robust to technical "fumbles" and provides a truer measure of the internal clock.

\textbf{Normalized Consistency:}
$$Cons_{norm} = 1.0 - \min(1.0, \frac{\sigma}{\text{Subdivision\_Interval}} \cdot \Gamma)$$
Ensures fair grading across the adaptive tempo range.

\end{document}
