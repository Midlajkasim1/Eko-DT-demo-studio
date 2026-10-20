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
function ekoCompareBars(groups,o){
  o=o||{};
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ok=v=>v!=null&&v!==''&&isFinite(v);
  const fmt=o.fmt||(v=>String(Math.round(v*10)/10));
  const list=(groups||[]).filter(g=>ok(g.a)||ok(g.b));
  if(!list.length) return {html:'',min:0,max:0};
  const unitOf=g=>(g.unit!=null&&g.unit!=='')?g.unit:(o.unit||'');
  const withU=(v,u)=>ok(v)?fmt(+v)+(u?(/^[°%]/.test(u)?u:' '+u):''):'—';
  const shared=new Set(list.map(unitOf)).size<=1;
  let lo=0,hi=1,ticks=[];
  if(shared){
    const nums=[];
    list.forEach(g=>{ if(ok(g.a)) nums.push(+g.a); if(ok(g.b)) nums.push(+g.b); });
    const mn=Math.min.apply(null,nums),mx=Math.max.apply(null,nums);
    const span=(mx-mn)||Math.abs(mx)||1,raw=span/3;
    const mag=Math.pow(10,Math.floor(Math.log10(raw)));
    const step=[1,2,2.5,5,10].map(m=>m*mag).find(s=>s>=raw*(1-1e-9));
    lo=Math.floor((mn-span*0.15)/step)*step; hi=Math.ceil((mx+span*0.1)/step)*step;
    if(mn>=0&&lo<0) lo=0;
    if(hi<=lo) hi=lo+step;
    const dec=Math.max(0,Math.ceil(-Math.log10(step)-1e-9))+(String(Math.round(step/mag*10)/10).indexOf('.')!==-1?1:0);
    for(let v=lo;v<=hi+step*1e-6;v+=step) ticks.push(+v.toFixed(dec));
    ticks=ticks.map(v=>({v:v,t:v.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec})}));
  }
  const pct=(v,l,h)=>Math.max(0,Math.min(100,(v-l)/((h-l)||1)*100)).toFixed(2);
  const rows=list.map(g=>{
    let l=lo,h=hi;
    if(!shared){
      const vs=[g.a,g.b].filter(ok).map(Number);
      l=Math.min.apply(null,[0].concat(vs)); h=Math.max.apply(null,vs);
      if(h<=l) h=l+1;
    }
    const bar=(v,k)=>ok(v)
      ? `<span class="cbxbar" data-k="${k}" style="height:${pct(+v,l,h)}%">${shared?'':`<b class="cbxval">${esc(fmt(+v))}</b>`}</span>`
      : `<span class="cbxbar" data-k="${k}" data-none="1"></span>`;
    const u=unitOf(g);
    const tip=`${g.label==null?'':g.label} · ${o.actLbl||'Actual'} ${withU(g.a,u)} · ${o.spLbl||'Setpoint'} ${withU(g.b,u)}`;
    return `<div class="cbxgrp" data-tip="${esc(tip)}"><div class="cbxbars">${bar(g.a,'act')}${bar(g.b,'sp')}</div><span class="cbxlbl">${esc(g.label)}</span></div>`;
  }).join('');
  const axisW=ticks.reduce((m,x)=>Math.max(m,x.t.length),0);
  const axis=shared?`<div class="cbxaxis" style="width:${axisW+0.5}ch">${ticks.map(x=>`<span style="bottom:${pct(x.v,lo,hi)}%">${esc(x.t)}</span>`).join('')}</div>`:'';
  const grid=shared?`<div class="cbxgrid">${ticks.filter(x=>x.v>lo).map(x=>`<i style="bottom:${pct(x.v,lo,hi)}%"></i>`).join('')}</div>`:'';
  const html=`<div class="cbx" data-axis="${shared?1:0}" style="--cbx-n:${list.length}">${axis}<div class="cbxscroll"><div class="cbxplot">${grid}${rows}</div></div></div>`;
  return {html:html,min:lo,max:hi};
}
