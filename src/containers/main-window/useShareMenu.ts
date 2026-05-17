import { useCallback, useEffect, useRef, useState } from "react";
import { SHARE_OPTIONS, SHARE_URL } from "../../constants/metronome";
import { openUrl } from "../../ipc";

/**
 * Owns share-menu UI state: open flag, "Copied!" tooltip, popover & button
 * refs, outside-click handling, and the option-click handler that either
 * copies the URL or opens an external share URL.
 *
 * Returns the bits the parent needs to wire into its header button and the
 * popover component.
 */
export function useShareMenu() {
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTooltip, setShareTooltip] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!shareOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (shareRef.current?.contains(target)) return;
      if (shareBtnRef.current?.contains(target)) return;
      setShareOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [shareOpen]);

  const handleShareOption = useCallback(
    (opt: (typeof SHARE_OPTIONS)[number]) => {
      if (opt.id === "copy") {
        navigator.clipboard.writeText(SHARE_URL).then(() => {
          setShareTooltip(true);
          setTimeout(() => setShareTooltip(false), 1800);
        });
      } else {
        openUrl(opt.url);
      }
      setShareOpen(false);
    },
    [],
  );

  return {
    shareOpen,
    setShareOpen,
    shareTooltip,
    shareRef,
    shareBtnRef,
    handleShareOption,
  };
}
