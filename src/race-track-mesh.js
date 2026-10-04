/* Render-only union of the physical Star Circuit corridor. No simulation state.
 * A single, globally sampled distance field replaces self-crossing offset ribbons.
 * Every grid triangle is partitioned into disjoint scalar bands exactly once. */
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? require("./art.js") : root.SpaceManArt);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpaceManRaceTrackMesh = api;
})(typeof window !== "undefined" ? window : globalThis, function (Art) {
  "use strict";
  const segmentCache = new WeakMap(), meshCache = new WeakMap();
  const rgb = (hex, fallback) => /^#[0-9a-f]{6}$/i.test(hex || "")
    ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    : fallback;
  const shade = (color, factor) => color.map((v) => Math.min(1, v * factor));

  function geometry(course) {
    if (!course || !Array.isArray(course.segments) || !course.segments.length)
      throw new TypeError("A course with physical segments is required");
    if (segmentCache.has(course)) return segmentCache.get(course);
    const lines = [], bounds = [Infinity, Infinity, -Infinity, -Infinity];
    course.segments.forEach((segment, index) => {
      const next = course.segments[(index + 1) % course.segments.length];
      const x = segment.x, z = segment.y,
        dx = segment.dx === undefined ? next.x - x : segment.dx,
        dz = segment.dy === undefined ? next.y - z : segment.dy;
      if (![x, z, dx, dz].every(Number.isFinite))
        throw new TypeError("Course segment coordinates must be finite");
      const lengthSquared = dx * dx + dz * dz;
      lines.push(x, z, dx, dz, lengthSquared ? 1 / lengthSquared : 0);
      bounds[0] = Math.min(bounds[0], x, x + dx);
      bounds[1] = Math.min(bounds[1], z, z + dz);
      bounds[2] = Math.max(bounds[2], x, x + dx);
      bounds[3] = Math.max(bounds[3], z, z + dz);
    });
    const result = { lines: new Float64Array(lines), bounds };
    segmentCache.set(course, result);
    return result;
  }

  function field(lines, x, z) {
    let best = Infinity;
    for (let i = 0; i < lines.length; i += 5) {
      const px = x - lines[i], pz = z - lines[i + 1],
        dx = lines[i + 2], dz = lines[i + 3],
        t = Math.max(0, Math.min(1, (px * dx + pz * dz) * lines[i + 4])),
        ex = px - dx * t, ez = pz - dz * t;
      best = Math.min(best, ex * ex + ez * ez);
    }
    return Math.sqrt(best);
  }

  // Exact distance to ALL physical line segments, including their end caps.
  // A prop footprint is clear only if this is greater than width / 2 + radius.
  function distance(course, x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
    return field(geometry(course).lines, x, z);
  }

  function intersection(a, b, level) {
    // Always intersect the original grid edge, even after earlier bands clipped
    // it. Adjacent bands/cells therefore share bit-identical Float32 endpoints.
    let lo, hi;
    if (a.edge) [lo, hi] = a.edge;
    else if (b.edge) [lo, hi] = b.edge;
    else [lo, hi] = [a, b];
    if (lo.d > hi.d) [lo, hi] = [hi, lo];
    const t = (level - lo.d) / (hi.d - lo.d);
    return { x: Math.fround(lo.x + (hi.x - lo.x) * t),
      z: Math.fround(lo.z + (hi.z - lo.z) * t), d: level, edge: [lo, hi] };
  }

  function split(polygon, level) {
    const inside = [], outside = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length],
        aInside = a.d <= level, bInside = b.d <= level;
      (aInside ? inside : outside).push(a);
      if (aInside !== bInside) {
        const crossing = intersection(a, b, level);
        inside.push(crossing);
        outside.push(crossing);
      }
    }
    return [inside, outside];
  }

  function partition(vertices, chunkSize) {
    const buckets = new Map();
    for (let start = 0; start < vertices.length; start += 27) {
      // Assign a whole triangle by its centroid. Do not clip, simplify, or
      // otherwise change its geometry at a chunk boundary.
      const column = Math.floor((vertices[start] + vertices[start + 9] +
          vertices[start + 18]) / (3 * chunkSize)),
        row = Math.floor((vertices[start + 2] + vertices[start + 11] +
          vertices[start + 20]) / (3 * chunkSize)),
        key = column + ":" + row;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { column, row, starts: [] };
        buckets.set(key, bucket);
      }
      bucket.starts.push(start);
    }
    const ordered = [...buckets.values()].sort((a, b) => a.row - b.row || a.column - b.column),
      packed = new Float32Array(vertices.length), chunks = [];
    let cursor = 0;
    for (const bucket of ordered) {
      const first = cursor,
        min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const start of bucket.starts) {
        for (let i = 0; i < 27; i++) packed[cursor + i] = vertices[start + i];
        for (let vertex = 0; vertex < 27; vertex += 9)
          for (let axis = 0; axis < 3; axis++) {
            // Read the final Float32 position, so a rounded-up height or
            // coordinate cannot accidentally fall outside the culling box.
            const value = packed[cursor + vertex + axis];
            min[axis] = Math.min(min[axis], value);
            max[axis] = Math.max(max[axis], value);
          }
        cursor += 27;
      }
      chunks.push({ vertices: packed.subarray(first, cursor), static: true,
        bounds: { min, max } });
    }
    // Only the final packed storage is retained. Full-mesh consumers and
    // culled chunk consumers share the same bytes; the temporary buckets die.
    return { vertices: packed, chunks };
  }

  function build(course) {
    if (meshCache.has(course)) return meshCache.get(course);
    if (!Number.isFinite(course && course.width) || course.width <= 0)
      throw new TypeError("Course width must be positive and finite");
    const { lines, bounds } = geometry(course), half = course.width / 2,
      palette = Art.circuitPalette(course), starlight = course.id === "starlight" || course.id === "prism",
      cellSize = Math.min(12, course.width / 12),
      // Distance to a segment is convex with curvature <= 1 / distance. This
      // conservative interpolation allowance is < 0.7 units on shipped tracks;
      // it prevents a tessellated chord from shaving the physical lane edge.
      coverageGuard = cellSize * cellSize / (4 * (half - Math.SQRT2 * cellSize)),
      roadRadius = half + coverageGuard,
      edge = rgb(starlight ? palette.edge : course.edge, [0.4, 0.9, 0.9]),
      road = rgb(starlight ? palette.road : course.road, [0.14, 0.21, 0.31]),
      accent = rgb(course.accent, [0.7, 0.95, 0.45]),
      // Keep other circuits' original numeric colors byte-for-byte, including
      // the computed ceramic and outer edge (no quantizing them through hex).
      curb = starlight ? rgb(palette.curb) :
        [0.69 + accent[0] * 0.12, 0.73 + accent[1] * 0.12, 0.75 + accent[2] * 0.12],
      apron = starlight ? rgb(palette.apron) : [0.075, 0.12, 0.17],
      outerEdge = starlight ? rgb(palette.outerEdge) : shade(edge, 0.38),
      bands = [
        { name: "road", radius: roadRadius, height: 0, color: road },
        { name: "edge", radius: roadRadius + 3.5, height: starlight ? 0.35 : 0.8, color: edge },
        { name: "curb", radius: roadRadius + 11.5, height: starlight ? 0.2 : 0.3, color: curb },
        { name: "apron", radius: half + 88, height: -3, color: apron },
        { name: "outerEdge", radius: half + 92, height: starlight ? -3 : -2, color: outerEdge },
        { name: "outerApron", radius: half + 95, height: -3, color: apron },
      ];
    const outer = bands[bands.length - 1].radius,
      minX = Math.floor((bounds[0] - outer) / cellSize) * cellSize,
      minZ = Math.floor((bounds[1] - outer) / cellSize) * cellSize,
      columns = Math.ceil((bounds[2] + outer - minX) / cellSize),
      rows = Math.ceil((bounds[3] + outer - minZ) / cellSize),
      grid = new Array((columns + 1) * (rows + 1)), vertices = [];
    const counts = bands.map(() => 0), areas = bands.map(() => 0);
    let minTriangleArea = Infinity;

    function heightAt(distance) {
      // One continuous profile for every band: the navigation strip is seated
      // in its ceramic curb, then a shallow bevel falls to the service deck.
      // Shared distance-field endpoints get the same Float32 Y from either
      // side. Road XZ tessellation, band radii and vertex count stay untouched.
      if (distance <= roadRadius) return 0;
      for (let i = 1; i < bands.length; i++) {
        const before = bands[i - 1], after = bands[i];
        if (distance <= after.radius) {
          const t = (distance - before.radius) / (after.radius - before.radius);
          return Math.fround(before.height + (after.height - before.height) * t);
        }
      }
      return bands[bands.length - 1].height;
    }
    for (let row = 0; row <= rows; row++) {
      const z = Math.fround(minZ + row * cellSize);
      for (let column = 0; column <= columns; column++) {
        const x = Math.fround(minX + column * cellSize);
        grid[row * (columns + 1) + column] = { x, z, d: field(lines, x, z) };
      }
    }

    function emit(polygon, bandIndex) {
      const band = bands[bandIndex];
      for (let i = 1; i + 1 < polygon.length; i++) {
        const a = polygon[0], b = polygon[i], c = polygon[i + 1],
          twiceArea = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        // Float32 endpoint rounding can collapse the tip of a clipped sliver.
        // Discard only zero-sized/subpixel remnants, never produce NaN normals.
        if (twiceArea <= 1e-7) continue;
        const area = twiceArea / 2;
        minTriangleArea = Math.min(minTriangleArea, area);
        counts[bandIndex]++;
        areas[bandIndex] += area;
        if (starlight) {
          const ay = heightAt(a.d), by = heightAt(b.d), cy = heightAt(c.d),
            ux = b.x - a.x, uy = by - ay, uz = b.z - a.z,
            vx = c.x - a.x, vy = cy - ay, vz = c.z - a.z,
            nx = uy * vz - uz * vy, ny = twiceArea, nz = ux * vy - uy * vx,
            length = Math.hypot(nx, ny, nz), normal = [nx / length, ny / length, nz / length];
          // Geometric normals use the actual stored Float32 endpoints, so
          // even rounded clipped slivers remain finite and upward-facing.
          for (const [p, y] of [[a, ay], [b, by], [c, cy]])
            vertices.push(p.x, y, p.z, ...normal, ...band.color);
        } else {
          for (const p of [a, b, c])
            vertices.push(p.x, band.height, p.z, 0, 1, 0, ...band.color);
        }
      }
    }

    function triangle(a, b, c) {
      const min = Math.min(a.d, b.d, c.d), max = Math.max(a.d, b.d, c.d);
      if (min > outer) return;
      let polygon = [a, b, c];
      for (let i = 0; i < bands.length && polygon.length >= 3; i++) {
        const radius = bands[i].radius;
        if (radius < min) continue;
        if (max <= radius) { emit(polygon, i); break; }
        const parts = split(polygon, radius);
        emit(parts[0], i);
        polygon = parts[1];
      }
    }

    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const index = row * (columns + 1) + column,
          a = grid[index], b = grid[index + 1],
          c = grid[index + columns + 1], d = grid[index + columns + 2];
        // Clockwise in XZ gives upward (+Y) geometric and supplied normals.
        triangle(a, c, d);
        triangle(a, d, b);
      }

    const chunkSize = 384, packed = partition(vertices, chunkSize),
      result = { vertices: packed.vertices, chunks: packed.chunks, static: true,
      diagnostics: {
        method: "global-distance-field-union", cellSize, columns, rows,
        chunkSize, chunkCount: packed.chunks.length,
        origin: [minX, minZ], fieldSamples: grid.length,
        physicalRadius: half, roadRadius, coverageGuard,
        vertexCount: vertices.length / 9, triangleCount: vertices.length / 27,
        minTriangleArea: Number.isFinite(minTriangleArea) ? minTriangleArea : 0,
        bands: bands.map((band, index) => ({ name: band.name,
          innerRadius: index ? bands[index - 1].radius : 0,
          outerRadius: band.radius, height: band.height,
          ...(starlight ? { innerHeight: index ? bands[index - 1].height : 0,
            outerHeight: band.height } : {}),
          triangleCount: counts[index], area: areas[index] })),
      } };
    meshCache.set(course, result);
    return result;
  }

  return Object.freeze({ build, distance });
});
