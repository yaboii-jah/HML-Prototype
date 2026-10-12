import assert from "node:assert/strict";

const epsilon = 0.0001;
const close = (a,b) => Math.abs(a-b) < epsilon;
const pointEqual = (a,b) => close(a[0],b[0]) && close(a[1],b[1]);
const segments = points => points.slice(1).map((point,index) => [points[index],point]).filter(([a,b]) => !pointEqual(a,b));

export function segmentIntersection([a,b],[c,d]) {
  const firstVertical = close(a[0],b[0]), secondVertical = close(c[0],d[0]);
  if (firstVertical === secondVertical) {
    const fixed = firstVertical ? 0 : 1, variable = 1-fixed;
    if (!close(a[fixed],c[fixed])) return null;
    const low = Math.max(Math.min(a[variable],b[variable]),Math.min(c[variable],d[variable]));
    const high = Math.min(Math.max(a[variable],b[variable]),Math.max(c[variable],d[variable]));
    if (high < low-epsilon) return null;
    const point = firstVertical ? [a[0],low] : [low,a[1]];
    return { kind: high-low > epsilon ? "overlap" : "touch", point };
  }
  const [vertical,horizontal] = firstVertical ? [[a,b],[c,d]] : [[c,d],[a,b]];
  const point = [vertical[0][0],horizontal[0][1]];
  if (point[0] < Math.min(horizontal[0][0],horizontal[1][0])-epsilon || point[0] > Math.max(horizontal[0][0],horizontal[1][0])+epsilon || point[1] < Math.min(vertical[0][1],vertical[1][1])-epsilon || point[1] > Math.max(vertical[0][1],vertical[1][1])+epsilon) return null;
  return { kind: "crossing", point };
}

export function segmentIntersectsRect([a,b],rect,padding = 0) {
  const left = rect.x-padding, right = rect.x+rect.w+padding;
  const top = rect.y-padding, bottom = rect.y+rect.h+padding;
  return close(a[0],b[0]) ? a[0] >= left && a[0] <= right && Math.max(a[1],b[1]) >= top && Math.min(a[1],b[1]) <= bottom : a[1] >= top && a[1] <= bottom && Math.max(a[0],b[0]) >= left && Math.min(a[0],b[0]) <= right;
}

const border = ([x,y],node) => {
  if (node.type === "decision") return close(Math.abs(x-node.x-node.w/2)/(node.w/2)+Math.abs(y-node.y-node.h/2)/(node.h/2),1);
  if (node.type === "junction") return close(Math.hypot(x-node.x-node.w/2,y-node.y-node.h/2),node.w/2);
  return (close(x,node.x) || close(x,node.x+node.w)) && y >= node.y && y <= node.y+node.h || (close(y,node.y) || close(y,node.y+node.h)) && x >= node.x && x <= node.x+node.w;
};
const inside = ([x,y],node) => {
  if (node.type === "decision") return Math.abs(x-node.x-node.w/2)/(node.w/2)+Math.abs(y-node.y-node.h/2)/(node.h/2) < 1-epsilon;
  if (node.type === "junction") return Math.hypot(x-node.x-node.w/2,y-node.y-node.h/2) < node.w/2-epsilon;
  return x > node.x+epsilon && x < node.x+node.w-epsilon && y > node.y+epsilon && y < node.y+node.h-epsilon;
};
const near = (point,toward) => [point[0]+(toward[0]-point[0])*0.01,point[1]+(toward[1]-point[1])*0.01];

export function validateGeometry(diagram,labels = []) {
  const nodes = new Map(diagram.nodes.map(node => [node.id,node]));
  const routes = diagram.edges.map((edge,index) => ({ ...edge,index,segments:segments(edge.points) }));
  for (const route of routes) {
    const source = nodes.get(route.from), target = nodes.get(route.to), name = `${route.from}/${route.to}`;
    assert.ok(source && target, `Unknown route endpoint: ${name}`);
    assert.ok(route.segments.length, `Empty connector: ${name}`);
    assert.ok(border(route.points[0],source), `Invalid source port: ${name}`);
    assert.ok(border(route.points.at(-1),target), `Invalid target port: ${name}`);
    assert.ok(!inside(near(route.segments[0][0],route.segments[0][1]),source), `Connector leaves through source interior: ${name}`);
    assert.ok(!inside(near(route.segments.at(-1)[1],route.segments.at(-1)[0]),target), `Connector approaches through target interior: ${name}`);
    for (const segment of route.segments) {
      assert.ok(close(segment[0][0],segment[1][0]) || close(segment[0][1],segment[1][1]), `Non-orthogonal route: ${name}`);
      for (const node of diagram.nodes.filter(node => ![route.from,route.to].includes(node.id))) assert.ok(!segmentIntersectsRect(segment,node,1), `Connector ${name} touches unrelated shape ${node.id}`);
      for (const label of labels) assert.ok(!segmentIntersectsRect(segment,label,2), `Connector ${name} intersects label ${label.id}`);
    }
    for (let i=0;i<route.segments.length;i++) for (let j=i+2;j<route.segments.length;j++) assert.ok(!segmentIntersection(route.segments[i],route.segments[j]), `Connector intersects itself: ${name}`);
  }
  for (let i=0;i<routes.length;i++) for (let j=i+1;j<routes.length;j++) {
    const a = routes[i], b = routes[j];
    for (const first of a.segments) for (const second of b.segments) {
      const intersection = segmentIntersection(first,second);
      if (!intersection) continue;
      // A shared endpoint is intentional only at a declared junction. Shared trunks are forbidden.
      const commonJunction = diagram.nodes.find(node => node.type === "junction" && [a.from,a.to].includes(node.id) && [b.from,b.to].includes(node.id) && border(intersection.point,node));
      assert.ok(intersection.kind !== "overlap" && commonJunction, `Connector ${intersection.kind}: ${a.from}/${a.to} and ${b.from}/${b.to} at ${intersection.point.join(",")}`);
    }
  }
  return { connectors: routes.length, crossings: 0, overlappingSegments: 0, labelCollisions: 0 };
}
