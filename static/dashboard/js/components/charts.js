/* ============================================================================
   EKO chart primitives — carried over VERBATIM from the approved reference,
   including their design reasoning. Do not "improve" these; the geometry
   decisions (per-gauge min/max, three tick labels) are product decisions.
   ============================================================================ */

// Semicircular gauge geometry for the Systems KPI cards. Each gauge carries its
// OWN min/max rather than pretending to be 0-100, so the needle sits where the
// number actually means something: 2.2 degC on a 0-10 scale reads low, while
// 2.2 on a 0-100 scale would pin uselessly to the left stop.
function ekoGauge(val,min,max,ramp){
  const CX=62,CY=66,R=46,TR=R-14,NR=R-12;
  const RAMP=ramp==='risk'?['#4EA36B','#7FBB55','#C4B03A','#D08A3C','#C25A5A']
    :['#9A8B2E','#C4B03A','#A9C24A','#72B85A','#4EA36B'];
  const at=(f,r)=>{const a=Math.PI*(1-f);return[CX+r*Math.cos(a),CY-r*Math.sin(a)]};
  const n=RAMP.length;
  const segs=RAMP.map((c,i)=>{
    const p=at(i/n,R),q=at((i+1)/n,R);
    return{d:'M'+p[0].toFixed(2)+','+p[1].toFixed(2)+' A'+R+','+R+' 0 0 1 '+q[0].toFixed(2)+','+q[1].toFixed(2),c:c}});
  // Three labels only: at 106px wide, six collide ("0.8" runs into "1.2").
  const ticks=[0,.5,1].map(f=>{
    const p=at(f,TR),v=min+(max-min)*f;
    return{t:String(Math.round(v*100)/100),
      css:'position:absolute;left:'+(p[0]/124*100).toFixed(2)+'%;top:'+(p[1]/78*100).toFixed(2)
        +'%;transform:translate(-50%,-50%);font-family:JetBrains Mono,monospace;font-size:9px;'
        +'font-weight:600;color:var(--t2);pointer-events:none;white-space:nowrap'}});
  const fr=Math.max(0,Math.min(1,(val-min)/((max-min)||1))),p=at(fr,NR);
  const arc=(a,b)=>{const q=at(a,R),w=at(b,R);
    return'M'+q[0].toFixed(2)+','+q[1].toFixed(2)+' A'+R+','+R+' 0 '+((b-a)>0.5?1:0)+' 1 '+w[0].toFixed(2)+','+w[1].toFixed(2)};
  return{segs:segs,ticks:ticks,cx:CX,cy:CY,nx:p[0].toFixed(2),ny:p[1].toFixed(2),
    track:arc(0,1),fillArc:fr>0.002?arc(0,fr):'',hasFill:fr>0.002};
}

// Ring gauge for percentage KPIs (Load Factor).
function ekoDonut(pct){
  const R=30,C=2*Math.PI*R,f=Math.max(0,Math.min(1,pct/100));
  return{r:R,cx:38,cy:38,dash:(C*f).toFixed(2)+' '+(C*(1-f)+1).toFixed(2),circ:C.toFixed(2)};
}

// Area + line trend with a mean marker (Peak Demand Trend).
function ekoTrend(vals,w,h){
  const mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals),pad=3,span=(mx-mn)||1;
  const y=v=>(h-pad-((v-mn)/span)*(h-2*pad));
  const pts=vals.map((v,i)=>[(i/(vals.length-1))*w,y(v)]);
  const line='M'+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' L');
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  return{line:line,area:line+' L'+w.toFixed(1)+','+h+' L0,'+h+' Z',
    avgY:y(avg).toFixed(1),avg:avg.toFixed(1),min:mn,max:mx,w:w,h:h};
}

// Grouped actual-vs-setpoint bars for the asset Analytics tab.
function ekoCompareBars(groups,w,h){
  const padT=8,padB=18,padX=6;
  const innerW=w-padX*2,innerH=h-padT-padB;
  const nums=[];
  (groups||[]).forEach(g=>{
    if(g.a!=null&&isFinite(g.a)) nums.push(+g.a);
    if(g.b!=null&&isFinite(g.b)) nums.push(+g.b);
  });
  if(!nums.length) return {svg:'',min:0,max:0};
  let lo=Math.min.apply(null,nums),hi=Math.max.apply(null,nums);
  const span=(hi-lo)||1;
  lo=lo-span*0.28; hi=hi+span*0.18;
  const y=v=>padT+innerH-((v-lo)/((hi-lo)||1))*innerH;
  const n=groups.length,slot=innerW/n,bw=Math.max(3.5,slot*0.3);
  const base=y(lo);
  let bars='';
  groups.forEach((g,i)=>{
    const cx=padX+i*slot+slot/2;
    const rect=(val,shift,fill)=>{
      if(val==null||!isFinite(val)) return '';
      const yv=y(val), top=Math.min(yv,base), ht=Math.max(Math.abs(yv-base),1);
      return `<rect x="${(cx+shift).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${ht.toFixed(1)}" rx="1.4" fill="${fill}"/>`;
    };
    bars+=rect(g.a,-bw-0.8,'var(--acc)')+rect(g.b,0.8,'var(--info)');
  });
  const labels=groups.map((g,i)=>{
    const x=padX+i*slot+slot/2;
    const t=String(g.label==null?'':g.label);
    return `<text x="${x.toFixed(1)}" y="${h-4}" text-anchor="middle" fill="var(--t3)" font-size="8">${t}</text>`;
  }).join('');
  return {svg:bars+labels,min:lo,max:hi,w:w,h:h};
}
