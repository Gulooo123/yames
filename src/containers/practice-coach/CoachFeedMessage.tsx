import { ScoreRing, ScoreBadge } from "../drill/evaluation";
import type { FeedAffordance, FeedChip, FeedMessage, SessionReport, SessionSegment } from "../../types";
import { formatTime, formatDuration } from "./coachCardHelpers";
import { accuracyPct } from "../../coach/reportStats";

/**
 * Discriminated union of every action the feed can dispatch. Combines
 * chip taps and intervention-affordance taps so the session hook can
 * own a single `handleChipAction` switch instead of two parallel
 * handlers. `messageId` is required for any action that needs to
 * resolve an affordance back onto its originating message (so the
 * UI can hide the buttons after a single tap).
 */
export type ChipAction =
  | { kind: "answer"; messageId: string; chip: FeedChip }
  | { kind: "set-bpm"; messageId?: string; bpmDelta: number }
  | { kind: "take-break"; messageId: string; durationMs: number }
  | { kind: "clear-calibration"; messageId: string }
  | { kind: "dismiss-affordance"; messageId: string }
  | { kind: "open-chat" };

/**
 * Renders a single feed message in the coach card. The feed contains a
 * heterogeneous mix of message types (system, coach-tip, user-chat,
 * mini-report, session-end) so this delegates each type to a small inline
 * renderer or to the dedicated EndReportSummary / SegmentTimeline helpers
 * below. Returning null for unknown types is intentional — keeps the feed
 * resilient to new message types added without UI yet.
 *
 * `onChipAction` is invoked when the user taps a chip OR a chip's
 * follow-up affordance. The parent (CoachCard) routes the action — chip
 * answers are appended as new feed messages; affordances trigger BPM
 * changes or open the free-text input.
 */
export function FeedMessageItem({
  message,
  onChipAction,
}: {
  message: FeedMessage;
  onChipAction?: (action: ChipAction) => void;
}) {
  switch (message.type) {
    case "session-start":
    case "system":
    case "coach-tip":
    case "coach-chat":
      return (
        <div className={`coach-feed-msg ${
          message.type === "coach-tip" ? "coach-feed-msg-tip" :
          message.type === "coach-chat" ? "coach-feed-msg-coach" :
          "coach-feed-msg-system"
        }`}>
          <span>{message.content}</span>
          {message.affordance && !message.affordanceResolved && (
            <AffordanceRow
              messageId={message.id}
              affordance={message.affordance}
              onAction={onChipAction}
            />
          )}
          <div className="coach-feed-msg-time">{formatTime(message.timestamp)}</div>
        </div>
      );

    case "user-chat":
      return (
        <div className="coach-feed-msg coach-feed-msg-user">
          <span>{message.content}</span>
          <div className="coach-feed-msg-time">{formatTime(message.timestamp)}</div>
        </div>
      );

    case "mini-report":
      // The mini-report card carries ONLY the coach's commentary on
      // the segment (score circle + text). Follow-up suggestion chips
      // are rendered as a separate `chip-prompt` message that the
      // session hook emits immediately after — keeps "content from
      // the coach" visually distinct from "input affordance for the
      // user". See `FeedMessageType` in `src/types.ts`.
      return (
        <div className="coach-feed-msg coach-feed-msg-mini-report">
          {message.report && (
            <div className="coach-mini-report-header">
              <ScoreRing score={message.report.score} size={40} strokeWidth={4} />
              <div className="coach-mini-report-stats">
                <span className="coach-mini-report-score-label">
                  {message.meta?.bpm ? `${message.meta.bpm} BPM` : "Segment"}
                </span>
                <span className="coach-mini-report-text">{message.content}</span>
              </div>
            </div>
          )}
          <div className="coach-feed-msg-time">{formatTime(message.timestamp)}</div>
        </div>
      );

    case "chip-prompt":
      // User-affordance bubble that follows a mini-report. Renders the
      // selector's chips with no surrounding "coach commentary" — the
      // message is explicitly FOR the user, not FROM the coach. The
      // mini-report case used to bundle these into its own card; they
      // looked like part of the coach's text and confused the
      // user/coach boundary.
      if (!message.chips || message.chips.length === 0) return null;
      return (
        <div className="coach-feed-msg coach-feed-msg-chip-prompt">
          <ChipRow
            chips={message.chips}
            onTap={(chip) =>
              onChipAction?.({ kind: "answer", messageId: message.id, chip })
            }
            onAffordance={(chip) => {
              if (!chip.affordance) return;
              if (chip.affordance.action === "set-bpm" && chip.affordance.bpmDelta) {
                onChipAction?.({ kind: "set-bpm", bpmDelta: chip.affordance.bpmDelta });
              } else if (chip.affordance.action === "open-chat") {
                onChipAction?.({ kind: "open-chat" });
              }
            }}
          />
        </div>
      );

    case "session-end":
      return (
        <div className="coach-feed-msg coach-feed-msg-session-end">
          <div className="coach-end-report-title">Session Complete</div>
          {message.content && <div className="coach-end-report-comment">{message.content}</div>}
          {message.report ? (
            <EndReportSummary report={message.report} />
          ) : (
            <span className="coach-mini-report-text">{message.content}</span>
          )}
          {message.segments && message.segments.length > 1 && (
            <SegmentTimeline segments={message.segments} sessionStart={message.segments[0].startTime ?? message.timestamp} />
          )}
          <div className="coach-feed-msg-time">{formatTime(message.timestamp)}</div>
        </div>
      );

    default:
      return null;
  }
}

function EndReportSummary({ report }: { report: SessionReport }) {
  // Accuracy uses SCORED beats (hits + misses) as the denominator — not
  // totalBeats — so a session that started before the user picked up the
  // instrument doesn't get a misleading "12% accuracy" because half the
  // metronome ticks landed in silence. The `accuracyPct` helper centralises
  // this calculation; see `src/coach/reportStats.ts` for the rationale.
  const accuracy = accuracyPct(report);

  return (
    <>
      <div className="coach-mini-report-header">
        <ScoreRing score={report.score} size={52} strokeWidth={5} />
        <div className="coach-mini-report-stats">
          <span className="coach-mini-report-score-label">Session Score</span>
          {/*
            The letter grade (F/D/C/B/A/S) was previously rendered here.
            Removed in v0.10 — a grade letter framed practice as an
            evaluation rather than a workout. Players hitting clean
            -3ms mean deviation were still seeing "F" because the audio
            pipeline under-detected onsets, and that felt punitive for
            a fun-practice tool. The composite 0-100 score in the ring
            (which is gradient-coloured) and the four-stat grid below
            convey progress without the academic letter. `report.grade`
            stays in the data model for older saved sessions and
            programmatic consumers.
          */}
        </div>
      </div>
      <div className="coach-end-report-grid">
        <div className="coach-end-report-stat">
          <span className="coach-end-report-stat-label">Accuracy</span>
          <span className="coach-end-report-stat-value">{accuracy}%</span>
        </div>
        <div className="coach-end-report-stat">
          <span className="coach-end-report-stat-label">Avg Deviation</span>
          <span className="coach-end-report-stat-value">{Math.abs(report.meanDeviationMs).toFixed(1)}ms</span>
        </div>
        <div className="coach-end-report-stat">
          <span className="coach-end-report-stat-label">Beats</span>
          <span className="coach-end-report-stat-value">{report.totalBeats}</span>
        </div>
        <div className="coach-end-report-stat">
          <span className="coach-end-report-stat-label">Best Streak</span>
          <span className="coach-end-report-stat-value">{report.longestStreak}</span>
        </div>
      </div>
    </>
  );
}

/**
 * Renders the 3-or-4 suggestion chips below a mini-report. Tapping the
 * chip label fires the answer; tapping the optional follow-up (e.g.
 * "Drop to 130 BPM") fires the affordance. The escape chip ("Ask
 * something else…") has no chip-answer text — it opens the chat input
 * via the affordance route.
 */
function ChipRow({
  chips,
  onTap,
  onAffordance,
}: {
  chips: FeedChip[];
  onTap: (chip: FeedChip) => void;
  onAffordance: (chip: FeedChip) => void;
}) {
  return (
    <div className="coach-chip-row">
      {chips.map((chip) => {
        const isEscape = chip.affordance?.action === "open-chat";
        return (
          <button
            key={chip.id}
            className={`coach-chip ${isEscape ? "coach-chip-escape" : ""}`}
            onClick={() => {
              if (isEscape) {
                // The escape chip routes straight to the chat input.
                onAffordance(chip);
              } else {
                onTap(chip);
              }
            }}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Renders the two-button affordance row attached to an intervention
 * tip (e.g. "Drop to 140 BPM" / "Stay at 150"). The primary button
 * dispatches the intervention's action; the secondary button just
 * dismisses the affordance (no side-effect on session state). In
 * both cases the parent hook marks `affordanceResolved` and the
 * buttons disappear — the tip text remains.
 *
 * The secondary "dismiss" button does NOT undo the intervention; it's
 * a "no, I'm fine" signal. The intervention's rate-cap entry was
 * already committed when the tip emitted.
 */
function AffordanceRow({
  messageId,
  affordance,
  onAction,
}: {
  messageId: string;
  affordance: FeedAffordance;
  onAction?: (action: ChipAction) => void;
}) {
  return (
    <div className="coach-affordance-row">
      <button
        className="coach-affordance-primary"
        onClick={() => {
          if (affordance.action.kind === "set-bpm") {
            onAction?.({ kind: "set-bpm", messageId, bpmDelta: affordance.action.bpmDelta });
          } else if (affordance.action.kind === "take-break") {
            onAction?.({ kind: "take-break", messageId, durationMs: affordance.action.durationMs });
          } else if (affordance.action.kind === "clear-calibration") {
            onAction?.({ kind: "clear-calibration", messageId });
          }
        }}
      >
        {affordance.actionLabel}
      </button>
      <button
        className="coach-affordance-secondary"
        onClick={() => onAction?.({ kind: "dismiss-affordance", messageId })}
      >
        {affordance.dismissLabel}
      </button>
    </div>
  );
}

function SegmentTimeline({ segments, sessionStart }: { segments: SessionSegment[]; sessionStart: number }) {
  return (
    <div className="coach-segment-timeline">
      <div className="coach-segment-timeline-title">Timeline</div>
      {segments.map((seg, i) => {
        const start = seg.startTime ?? sessionStart;
        const end = seg.endTime ?? start;
        const offsetSec = Math.round((start - sessionStart) / 1000);
        const durationSec = Math.round((end - start) / 1000);
        // Accuracy uses SCORED beats (hits + miss) — same denominator as
        // the Rust score and EndReportSummary, so the per-segment accuracy
        // in the timeline doesn't disagree with the overall accuracy
        // above. See `src/coach/reportStats.ts`.
        const accuracy = accuracyPct(seg.report);
        const style = seg.report.gridCorrelation > 0.8 ? "Grid exercise"
          : seg.report.gridCorrelation > 0.3 ? "Semi-structured"
          : "Free playing";
        const pocket = seg.report.meanDeviationMs < -5 ? "rushing"
          : seg.report.meanDeviationMs > 5 ? "dragging" : "on beat";

        return (
          <div key={i} className="coach-segment-row">
            <div className="coach-segment-time">
              {formatDuration(offsetSec)}–{formatDuration(offsetSec + durationSec)}
            </div>
            <div className="coach-segment-info">
              <span className="coach-segment-style">{style}</span>
              <span className="coach-segment-sep">&middot;</span>
              <span>{seg.bpm} BPM</span>
              <span className="coach-segment-sep">&middot;</span>
              <span>{accuracy}%</span>
              <span className="coach-segment-sep">&middot;</span>
              <span>{pocket}</span>
            </div>
            <ScoreBadge score={seg.report.score} />
          </div>
        );
      })}
    </div>
  );
}
