(function () {
  const output = document.createElement('output');
  output.id = 'frame-profile';
  output.style.cssText = 'position:fixed;left:8px;top:8px;z-index:1000;max-width:95vw;padding:6px 10px;background:#080714e8;color:white;font:11px monospace;pointer-events:none;white-space:pre-wrap';
  output.textContent = 'Frame profile ready';
  document.body.appendChild(output);
  let capture = null, taskObserver;
  try { taskObserver = new PerformanceObserver(list => { if (capture) capture.longTasks.push(...list.getEntries().map(task => task.duration)); }); taskObserver.observe({type:'longtask', buffered:false}); } catch (_) { taskObserver = null; }
  function start(label, duration) {
    if (capture) return;
    const sample = capture = {label, end:performance.now()+duration, frames:[], longTasks:[]};
    output.textContent = `${label}: measuring…`;
    function frame(now) {
      sample.frames.push(now);
      if (now < sample.end) { requestAnimationFrame(frame); return; }
      const times = sample.frames.slice(1).map((value,index) => value-sample.frames[index]);
      const sorted = times.slice().sort((a,b)=>a-b);
      const result = {
        label, frames:times.length,
        fps:+(times.length*1000/(sample.frames.at(-1)-sample.frames[0])).toFixed(1),
        medianMs:+sorted[Math.floor(sorted.length*.5)].toFixed(2),
        p95Ms:+sorted[Math.floor(sorted.length*.95)].toFixed(2),
        maxMs:+Math.max(...times).toFixed(2),
        framesOver25ms:times.filter(time=>time>25).length,
        longTasksSupported:Boolean(taskObserver), longTasks:sample.longTasks.map(value=>+value.toFixed(2))
      };
      output.textContent = JSON.stringify(result);
      capture = null;
    }
    requestAnimationFrame(frame);
  }
  window.addEventListener('click', event => {
    if (event.target.closest('#play-game,#play-again,#go-home')) start('screen transition',1100);
    else if (event.target.closest('.tile') && document.getElementById('board').classList.contains('busy')) start('swap and cascades',2600);
  });
})();
