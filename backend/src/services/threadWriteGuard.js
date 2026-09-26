// Collision guard for the two final-writer operations on a thread (reply and
// farewell). Node executes each Express request handler to completion and
// better-sqlite3 writes are synchronous, so two handlers never interleave their
// writes. What still needs detecting is when two requests genuinely arrive in
// the same instant ("告别与回复撞在一起") rather than one deliberately following
// the other.
//
// Measured event-loop ordering for two HTTP POSTs whose bodies are already
// buffered (same poll batch), relative to handler #1:
//
//   same-burst:  end#1 -> imm1 -> setTimeout0 -> end#2 -> imm2
//   sequential:  end#1 -> imm1 -> setTimeout0 -> imm2  -> end#2
//
// Releasing the slot at the second setImmediate (imm2) therefore rejects the
// second writer of a same-instant pair while letting any genuinely sequential
// request through. Reservation always self-clears, so a failed handler cannot
// wedge the thread.

const activeRoots = new Set();

const ThreadWriteGuard = {
  // Marks rootId as currently being written. Returns true for the first writer
  // in this burst, false if another writer is still in flight (a collision).
  tryAcquire(rootId) {
    if (activeRoots.has(rootId)) return false;
    activeRoots.add(rootId);
    setImmediate(() =>
      setImmediate(() => {
        activeRoots.delete(rootId);
      })
    );
    return true;
  }
};

module.exports = ThreadWriteGuard;
