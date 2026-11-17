"use client";

import { useLinkStatus } from "next/link";

/**
 * Place inside a <Link>. While that link's navigation is pending, shows a thin
 * accent bar across the top of the window (and lets the link style itself via
 * the `link-pending` class on its parent, see globals.css). Renders nothing otherwise.
 */
export function PendingBar() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <>
      <span className="pending-bar" aria-hidden />
      <span className="sr-only" role="status">
        Loading
      </span>
    </>
  );
}
