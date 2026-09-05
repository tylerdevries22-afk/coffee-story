/**
 * The root is a signpost, not a screen.
 *
 * A display is always pointed at one location, so there is nothing sensible to
 * show without one. Saying so plainly beats redirecting to a guessed location
 * and putting the wrong shop's queue on a wall.
 */
export default function DisplayIndex() {
  return (
    <main className="display-root display-signpost">
      <h1 className="board-title">Location display</h1>
      <p className="board-empty">
        Open this screen at <code>/board/&lt;location&gt;</code> to show that
        location&apos;s live information.
      </p>
    </main>
  );
}
