export function humanCursorPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  numPoints = 80,
): Array<{ x: number; y: number }> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return [from, to];

  const spread = Math.min(200, Math.max(20, dist * 0.3));
  const side = Math.random() > 0.5 ? 1 : -1;
  const perpX = -dy / dist;
  const perpY = dx / dist;
  const t1 = 0.2 + Math.random() * 0.3;
  const t2 = 0.5 + Math.random() * 0.3;
  const offset1 = (Math.random() * 0.8 + 0.2) * spread * side;
  const offset2 = (Math.random() * 0.8 + 0.2) * spread * side;
  const cp1 = {
    x: from.x + dx * t1 + perpX * offset1,
    y: from.y + dy * t1 + perpY * offset1,
  };
  const cp2 = {
    x: from.x + dx * t2 + perpX * offset2,
    y: from.y + dy * t2 + perpY * offset2,
  };

  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= numPoints; i += 1) {
    let t = i / numPoints;
    t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const mt = 1 - t;
    const x =
      mt * mt * mt * from.x +
      3 * mt * mt * t * cp1.x +
      3 * mt * t * t * cp2.x +
      t * t * t * to.x;
    const y =
      mt * mt * mt * from.y +
      3 * mt * mt * t * cp1.y +
      3 * mt * t * t * cp2.y +
      t * t * t * to.y;

    const jitter = i > 0 && i < numPoints ? 1.5 : 0;
    points.push({
      x: x + (Math.random() - 0.5) * jitter,
      y: y + (Math.random() - 0.5) * jitter,
    });
  }
  return points;
}

export function humanMultiWaypointPath(
  waypoints: Array<{ x: number; y: number; dwell?: number }>,
  pointsPerSegment = 60,
  dwellFrames = 30,
): Array<{ x: number; y: number }> {
  const allPoints: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < waypoints.length; i += 1) {
    if (i > 0) {
      allPoints.push(
        ...humanCursorPath(waypoints[i - 1]!, waypoints[i]!, pointsPerSegment),
      );
    }

    const frames = waypoints[i]!.dwell || dwellFrames;
    for (let frame = 0; frame < frames; frame += 1) {
      const t = frame / frames;
      allPoints.push({
        x: waypoints[i]!.x + Math.sin(t * Math.PI * 2 * 0.8) * 2,
        y: waypoints[i]!.y + Math.cos(t * Math.PI * 2 * 1.1) * 2,
      });
    }
  }

  return allPoints;
}
