// extract-tabla-sablon.mjs
//
// Extracts a TABLA panel model's V-carve toolpaths as an anchored "sablon"
// template (see client/src/lib/gcode/features.js buildSablonPaths):
//
//   node server/scripts/extract-tabla-sablon.mjs "numuneler/TABLA MODELLERİMİZ pano şeklinde.anc" 13 1 out.json
//
// The panel is 1390 x 2100 with 4 x 4 doors of 347.5 x ~462.5; door edges are
// the T6 cut lines at X 0/347.5/695/1042.5/1390 and Y 0/463/925/1388/1850.
// Points are written as [x, y, depth, ax, ay]: ax/ay say which edge the point
// follows (0 = left/bottom, 1 = right/top). A whole ornament follows the corner
// it sits in; a straight frame arm keeps its perpendicular side and its free end
// follows the ornament it runs into, so arms stretch on bigger doors.
import fs from 'node:fs';
const [,, ancPath, modelArg, toolArg, outPath] = process.argv;
const MODEL = +modelArg, TOOL = +(toolArg || 1);
const txt = fs.readFileSync(ancPath, 'latin1').split(/\r?\n/);
const cols=[0,347.5,695,1042.5,1390], rows=[1850,1388,925,463,0];
const r=Math.floor((MODEL-1)/4), c=(MODEL-1)%4, X0=cols[c], Y0=rows[r+1], W=347.5, H=rows[r]-rows[r+1];
let T=null,x=0,y=0,z=30,mode=0; const passes=[]; let cur=null;
const flush=()=>{ if(cur&&cur.length>1) passes.push(cur); cur=null; };
for (const raw of txt) { const l = raw.replace(/^N\d+\s*/,''); let m;
  if ((m=l.match(/M6\s*T(\d+)/))) { flush(); T=+m[1]; }
  if ((m=l.match(/\bG0?([0123])\b/))) mode=+m[1];
  const px=x, py=y, pz=z;
  if ((m=l.match(/X(-?[\d.]+)/))) x=+m[1];
  if ((m=l.match(/Y(-?[\d.]+)/))) y=+m[1];
  if ((m=l.match(/Z(-?[\d.]+)/))) z=+m[1];
  if (!/[XYZ]/.test(l)) continue;
  if (T!==TOOL) { flush(); continue; }
  if (z>=18-1e-6) { if (cur && mode!==0 && (x!==px||y!==py)) cur.push([x,y,18]); flush(); continue; }
  if (!cur) { cur=[]; if (pz>=18 && mode!==0 && (x!==px||y!==py)) cur.push([px,py,18]); }
  const rm = l.match(/R(-?[\d.]+)/);
  if ((mode===2||mode===3) && rm) {
    // R-format arc: centre from chord + radius; R<0 = the major arc
    const R=+rm[1], ar=Math.abs(R), dx=x-px, dy=y-py, d=Math.hypot(dx,dy);
    cur.hasArc = true;
    if (d>1e-9 && ar>=d/2-1e-6) {
      const h=Math.sqrt(Math.max(0,ar*ar-d*d/4)), mx=(px+x)/2, my=(py+y)/2, ux=-dy/d, uy=dx/d;
      // CCW (G3) minor arc has its centre on the left of the chord
      const sgn=((mode===3)===(R>0))?1:-1, ccx=mx+sgn*h*ux, ccy=my+sgn*h*uy;
      let a0=Math.atan2(py-ccy,px-ccx), a1=Math.atan2(y-ccy,x-ccx);
      if (mode===3) { while(a1<=a0) a1+=2*Math.PI; } else { while(a1>=a0) a1-=2*Math.PI; }
      const n=Math.max(2,Math.ceil(Math.abs(a1-a0)*ar/0.5));
      for(let i=1;i<n;i++){ const a=a0+(a1-a0)*i/n; cur.push([ccx+ar*Math.cos(a), ccy+ar*Math.sin(a), pz+(z-pz)*i/n]); }
    }
  }
  cur.push([x,y,z]);
}
flush();
// keep passes whose centre is in this model's cell; drop the "MODEL N" label engraving
const mine = passes.map(p=>{ const q=p.map(([a,b,cz])=>[a-X0,b-Y0,cz]); q.hasArc=p.hasArc; return q; }).filter(p=>{
  const xs=p.map(q=>q[0]), ys=p.map(q=>q[1]);
  const cx=(Math.min(...xs)+Math.max(...xs))/2, cy=(Math.min(...ys)+Math.max(...ys))/2;
  if (cx<0||cx>W||cy<0||cy>H) return false;
  const label = (Math.max(...xs)-Math.min(...xs))<140 && Math.max(...ys)<35 && Math.min(...ys)>5;
  return !label;
});
// classify per segment: a "long" segment is axis-aligned and > 20mm (a frame arm)
const longSegs = (p)=>{ const out=[]; for(let i=1;i<p.length;i++){ const dx=Math.abs(p[i][0]-p[i-1][0]), dy=Math.abs(p[i][1]-p[i-1][1]); if((dx<0.02&&dy>20)||(dy<0.02&&dx>20)) out.push(i); } return out; };
const bboxOf=(p)=>{ const xs=p.map(q=>q[0]), ys=p.map(q=>q[1]); return {x1:Math.min(...xs),x2:Math.max(...xs),y1:Math.min(...ys),y2:Math.max(...ys)}; };
const orn = mine.filter(p=>!longSegs(p).length).map(bboxOf).filter(b=>Math.hypot(b.x2-b.x1,b.y2-b.y1)>40);
const sideX = (v)=> v<=W/2?0:1, sideY=(v)=> v<=H/2?0:1;
const ornX = (px,py,dir)=>{ let best=null, bd=1e9; for(const o of orn){ if(dir>0 ? o.x2<px : o.x1>px) continue; const dy = py<o.y1?o.y1-py:py>o.y2?py-o.y2:0; if(dy>15) continue; const dx = px<o.x1?o.x1-px:px>o.x2?px-o.x2:0; if(dx<bd){bd=dx;best=o;} } return best? sideX((best.x1+best.x2)/2) : sideX(px); };
const ornY = (px,py,dir)=>{ let best=null, bd=1e9; for(const o of orn){ if(dir>0 ? o.y2<py : o.y1>py) continue; const dx = px<o.x1?o.x1-px:px>o.x2?px-o.x2:0; if(dx>15) continue; const dy = py<o.y1?o.y1-py:py>o.y2?py-o.y2:0; if(dy<bd){bd=dy;best=o;} } return best? sideY((best.y1+best.y2)/2) : sideY(py); };
const r3=(v)=>Math.round(v*1000)/1000;
const armEnds=[];
const build = (p)=>{
  const segs = longSegs(p);
  const pt = (q,ax,ay)=>[r3(q[0]),r3(q[1]),r3(Math.max(0,18-q[2])),ax,ay];
  if (!segs.length) {
    const b=bboxOf(p);
    // a small piece sitting on the end of a frame arm (its cap) follows that arm end
    if (Math.hypot(b.x2-b.x1,b.y2-b.y1) <= 40) {
      const cx=(b.x1+b.x2)/2, cy=(b.y1+b.y2)/2; let best=null, bd=12;
      for (const e of armEnds) { const d=Math.hypot(e.x-cx,e.y-cy); if (d<bd) { bd=d; best=e; } }
      if (best) return p.map(q=>pt(q,best.ax,best.ay));
    }
    const ax=sideX((b.x1+b.x2)/2), ay=sideY((b.y1+b.y2)/2); return p.map(q=>pt(q,ax,ay));
  }
  // anchors of every long-segment endpoint
  const anchor = new Map();
  for (const i of segs) {
    const a=p[i-1], b=p[i]; const vert = Math.abs(a[0]-b[0])<0.02;
    for (const [k,q,o] of [[i-1,a,b],[i,b,a]]) {
      const prev = anchor.get(k) || {};
      // perpendicular coordinate follows the nearest edge, the along coordinate the ornament the arm runs into
      if (vert) { prev.ax = sideX(q[0]); if (prev.ay===undefined) prev.ay = ornY(q[0], q[1], q[1]>o[1]?1:-1); }
      else { prev.ay = sideY(q[1]); if (prev.ax===undefined) prev.ax = ornX(q[0], q[1], q[0]>o[0]?1:-1); }
      anchor.set(k, prev);
    }
  }
  // a corner shared by a vertical and a horizontal arm takes each arm's perpendicular side
  const keys=[...anchor.keys()].sort((a,b)=>a-b);
  return p.map((q,i)=>{
    let k = i; if (!anchor.has(k)) { k = keys.reduce((best,c)=>Math.abs(c-i)<Math.abs(best-i)?c:best, keys[0]); }
    const a = anchor.get(k); return pt(q, a.ax ?? sideX(q[0]), a.ay ?? sideY(q[1]));
  });
};
const firstPass = mine.map(p=>longSegs(p).length ? build(p) : null);
firstPass.forEach(p=>{ if(!p) return; for (const q of p) armEnds.push({x:q[0],y:q[1],ax:q[3],ay:q[4]}); });
const out = mine.map((p,i)=>firstPass[i] || build(p));
// Ramer-Douglas-Peucker in 3D (0.02 mm): the interpolated arcs and ArtCAM's
// dense V-carve moves shrink a lot with no visible change.
const rdp = (pts, eps) => {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]]; const L2 = ab[0]**2+ab[1]**2+ab[2]**2;
  let idx = -1, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]; const ap = [p[0]-a[0], p[1]-a[1], p[2]-a[2]];
    const t = L2 ? Math.max(0, Math.min(1, (ap[0]*ab[0]+ap[1]*ab[1]+ap[2]*ab[2]) / L2)) : 0;
    const d = Math.hypot(ap[0]-t*ab[0], ap[1]-t*ab[1], ap[2]-t*ab[2]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
};
// drop consecutive duplicates
const clean = out.map(p=>rdp(p,0.02)).map(p=>p.filter((q,i)=>!i || q[0]!==p[i-1][0] || q[1]!==p[i-1][1] || q[2]!==p[i-1][2])).filter(p=>p.length>1);
const pts = clean.reduce((s,p)=>s+p.length,0);
console.log(`model ${MODEL} T${TOOL}: ${clean.length} paths, ${pts} points, straight ${mine.filter(p=>longSegs(p).length).length}, ornaments ${orn.length}, ref ${W}x${H}, maxDepth ${Math.max(...clean.flat().map(q=>q[2]))}`);
fs.writeFileSync(outPath, JSON.stringify({ refWidth: W, refHeight: H, paths: clean }));
