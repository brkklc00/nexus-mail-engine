"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function OverlayPortal({
  children,
  active = true,
  lockScroll = true
}: {
  children: ReactNode;
  active?: boolean;
  lockScroll?: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !active || !lockScroll) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mounted, active, lockScroll]);

  if (!mounted || !active) return null;
  return createPortal(children, document.body);
}
