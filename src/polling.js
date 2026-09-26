'use strict';
// No overlapping scans. Larger read/save cycles get a bounded idle interval,
// avoiding an always-busy collector. Manual collection remains available.
function nextDelay(configuredMs,cycleMs){
  const base=Number.isFinite(configuredMs)?Math.max(1000,Math.min(60000,configuredMs)):5000;
  const work=Number.isFinite(cycleMs)?Math.max(0,cycleMs):0;
  return Math.min(60000,Math.max(base,Math.ceil(work*2)));
}
module.exports={nextDelay};
