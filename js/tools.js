/* =========================================================================
   戎糖小记 · tools.js（工具箱 页面独有脚本）
   两个工具，全部在浏览器本地跑，不上传、不请求接口：
     ① 图片压缩 / 转格式（Canvas 重绘）
     ② PDF 转图片（自托管的 pdf.js：assets/vendor/pdf.min.js + pdf.worker.min.js）
   依赖都在 app.js 里（菜单 / 吸顶 / 滚动进场 / 加载特效），这里只管工具本身。
   ========================================================================= */
(function () {
  'use strict';

  var doc = document;
  function $(id) { return doc.getElementById(id); }
  function say(el, text, bad) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-bad', !!bad);
  }
  function fmtSize(b) {
    if (!b && b !== 0) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  /* 拖拽通用：拖进来高亮，松手交给回调 */
  function bindDrop(dropEl, onFile) {
    if (!dropEl) return;
    ['dragenter', 'dragover'].forEach(function (t) {
      dropEl.addEventListener(t, function (e) { e.preventDefault(); dropEl.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      dropEl.addEventListener(t, function (e) { e.preventDefault(); dropEl.classList.remove('is-over'); });
    });
    dropEl.addEventListener('drop', function (e) {
      var list = e.dataTransfer && e.dataTransfer.files;
      if (list && list.length) onFile(list[0]);
    });
  }

  /* =======================================================================
     ① 图片压缩 / 转格式
     ======================================================================= */
  (function imageTool() {
    var input = $('imgFile'), run = $('imgRun'), note = $('imgNote'), out = $('imgResults');
    var fmt = $('imgFormat'), quality = $('imgQuality'), qualityVal = $('imgQualityVal'), maxEdge = $('imgMax');
    if (!input || !run) return;
    var queue = [];

    if (quality && qualityVal) {
      quality.addEventListener('input', function () { qualityVal.textContent = quality.value + '%'; });
    }

    function pick(file) {
      if (!file) return;
      if (!/^image\//.test(file.type)) { say(note, '这个不是图片文件：' + file.name, true); return; }
      queue.push(file);
      run.disabled = false;
      say(note, '已选 ' + queue.length + ' 张，点「开始处理」。');
    }
    input.addEventListener('change', function () {
      var list = input.files;
      for (var i = 0; i < list.length; i++) pick(list[i]);
      input.value = '';
    });
    bindDrop($('imgDrop'), pick);

    function baseName(name) {
      return String(name || 'image').replace(/\.[^.]+$/, '') || 'image';
    }

    function renderRow(item) {
      var row = doc.createElement('div');
      row.className = 'tool-row';

      var img = doc.createElement('img');
      img.className = 'tool-row_thumb';
      img.src = item.url;
      img.alt = item.name + ' 预览';
      img.height = 52;
      row.appendChild(img);

      var main = doc.createElement('div');
      main.className = 'tool-row_main';
      var name = doc.createElement('p');
      name.className = 'tool-row_name';
      name.textContent = item.name;
      var meta = doc.createElement('p');
      meta.className = 'tool-row_meta';
      var pct = item.from > 0 ? Math.max(0, Math.round((1 - item.to / item.from) * 100)) : 0;
      meta.innerHTML = '';
      meta.appendChild(doc.createTextNode(fmtSize(item.from) + ' → '));
      var b = doc.createElement('b');
      b.textContent = fmtSize(item.to);
      meta.appendChild(b);
      meta.appendChild(doc.createTextNode(
        ' · ' + item.w + '×' + item.h + (pct > 0 ? ' · 省 ' + pct + '%' : ' · 没变小（换高质量或原格式试试）')
      ));
      main.appendChild(name);
      main.appendChild(meta);

      var dl = doc.createElement('a');
      dl.className = 'tool-row_dl';
      dl.href = item.url;
      dl.download = item.name;
      dl.textContent = '下载';

      row.appendChild(main);
      row.appendChild(dl);
      return row;
    }

    run.addEventListener('click', function () {
      if (!queue.length) return;
      var type = fmt.value === 'keep' ? '' : fmt.value;
      var q = Math.max(0.3, Math.min(1, (parseInt(quality.value, 10) || 80) / 100));
      var limit = parseInt(maxEdge.value, 10) || 0;
      out.innerHTML = '';
      out.hidden = false;
      run.disabled = true;
      say(note, '处理中… 0 / ' + queue.length);

      var done = 0, failed = 0;
      queue.forEach(function (file) {
        var useType = type || file.type || 'image/jpeg';
        var job = (window.createImageBitmap ? createImageBitmap(file) : Promise.reject(new Error('浏览器不支持')))
          .then(function (bmp) {
            var w = bmp.width, h = bmp.height;
            if (limit && Math.max(w, h) > limit) {
              var k = limit / Math.max(w, h);
              w = Math.max(1, Math.round(w * k));
              h = Math.max(1, Math.round(h * k));
            }
            var cv = doc.createElement('canvas');
            cv.width = w; cv.height = h;
            var ctx = cv.getContext('2d');
            ctx.drawImage(bmp, 0, 0, w, h);
            if (bmp.close) bmp.close();
            return new Promise(function (res) {
              cv.toBlob(function (blob) {
                if (blob) res(blob);
                else {
                  /* 极少数浏览器对 webp 编码不支持，退回 jpeg */
                  cv.toBlob(function (b2) { res(b2 || null); }, 'image/jpeg', q);
                }
              }, useType, useType === 'image/png' ? undefined : q);
            }).then(function (blob) {
              /* 宽高跟着 blob 一起往回带：它们是上个 then 里的局部变量，跨 then 取不到 */
              return { blob: blob, w: w, h: h };
            });
          })
          .then(function (r) {
            if (!r || !r.blob) throw new Error('编码失败');
            var ext = (r.blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
            return {
              name: baseName(file.name) + '.' + ext,
              from: file.size,
              to: r.blob.size,
              w: r.w, h: r.h,
              url: URL.createObjectURL(r.blob)
            };
          })
          .catch(function () { failed++; return null; })
          .then(function (item) {
            done++;
            if (item) out.appendChild(renderRow(item));
            say(note, '处理中… ' + done + ' / ' + queue.length + (failed ? '，' + failed + ' 张失败' : ''));
            if (done === queue.length) {
              run.disabled = false;
              say(note, failed
                ? '完成，成功 ' + (queue.length - failed) + ' 张，失败 ' + failed + ' 张（可能是格式不支持）。'
                : '全部完成，共 ' + queue.length + ' 张。点每张右边的「下载」保存。');
              queue = [];
            }
          });
      });
    });
  })();

  /* =======================================================================
     ② PDF 转图片（pdf.js 自托管，首次用到才加载）
     ======================================================================= */
  (function pdfTool() {
    var input = $('pdfFile'), run = $('pdfRun'), note = $('pdfNote'), out = $('pdfResults');
    var fmt = $('pdfFormat'), scale = $('pdfScale'), scaleVal = $('pdfScaleVal');
    var quality = $('pdfQuality'), qualityVal = $('pdfQualityVal');
    var rangeInput = $('pdfRange'), progress = $('pdfProgress'), bar = $('pdfProgressBar');
    if (!input || !run) return;

    var file = null, pages = 0, libP = null, bytes = null, pdfDoc = null;

    if (scale && scaleVal) scale.addEventListener('input', function () { scaleVal.textContent = scale.value + ' 倍'; });
    if (quality && qualityVal) quality.addEventListener('input', function () { qualityVal.textContent = quality.value + '%'; });

    /* File → Uint8Array（老浏览器没有 File.arrayBuffer，用 FileReader 兜底） */
    function readBytes(f) {
      if (bytes) return Promise.resolve(bytes);
      var p = f.arrayBuffer ? f.arrayBuffer() : new Promise(function (res) {
        var fr = new FileReader();
        fr.onload = function () { res(fr.result); };
        fr.readAsArrayBuffer(f);
      });
      return p.then(function (buf) { bytes = new Uint8Array(buf); return bytes; });
    }

    /* 按需加载 pdf.js：1.3MB 不该拖慢首屏 */
    function loadLib() {
      if (libP) return libP;
      libP = new Promise(function (res, rej) {
        if (window.pdfjsLib) return res(window.pdfjsLib);
        var s = doc.createElement('script');
        s.src = 'assets/vendor/pdf.min.js';
        s.onload = function () {
          var lib = window.pdfjsLib;
          if (!lib) return rej(new Error('pdf.js 加载失败'));
          lib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
          res(lib);
        };
        s.onerror = function () { rej(new Error('pdf.js 加载失败')); };
        doc.head.appendChild(s);
      });
      return libP;
    }

    function pick(f) {
      if (!f) return;
      if (!/pdf$/i.test(f.name) && f.type !== 'application/pdf') {
        say(note, '请选 PDF 文件：' + f.name, true);
        return;
      }
      file = f;
      bytes = null;
      pdfDoc = null;
      run.disabled = true;
      say(note, '正在读取 PDF…');
      /* pdf.js 的 data 只吃 TypedArray / ArrayBuffer / base64 字符串，不吃 File，
         所以先读成 Uint8Array；顺便把文档对象留着，转换时不用每页重新解析 */
      readBytes(f).then(function (u8) {
        return loadLib().then(function (lib) { return lib.getDocument({ data: u8 }).promise; });
      }).then(function (pdf) {
        pdfDoc = pdf;
        pages = pdf.numPages;
        run.disabled = false;
        say(note, '已选 ' + f.name + '（' + fmtSize(f.size) + '，共 ' + pages + ' 页）');
      }).catch(function (e) {
        run.disabled = true;
        say(note, '打不开这个 PDF：' + (e && e.message ? e.message : '文件可能损坏或加密'), true);
      });
    }
    input.addEventListener('change', function () { pick(input.files[0]); input.value = ''; });
    bindDrop($('pdfDrop'), pick);

    /* "1-3,8" → [1,2,3,8]；空 = 全部 */
    function parseRange(text, total) {
      var s = String(text || '').trim();
      if (!s) { var all = []; for (var i = 1; i <= total; i++) all.push(i); return all; }
      var out = [], seen = {};
      s.split(',').forEach(function (part) {
        part = part.trim();
        if (!part) return;
        var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) {
          var a = Math.max(1, parseInt(m[1], 10)), b = Math.min(total, parseInt(m[2], 10));
          if (a > b) { var t = a; a = b; b = t; }
          for (var i = a; i <= b; i++) { if (!seen[i]) { seen[i] = 1; out.push(i); } }
        } else if (/^\d+$/.test(part)) {
          var n = parseInt(part, 10);
          if (n >= 1 && n <= total && !seen[n]) { seen[n] = 1; out.push(n); }
        }
      });
      return out;
    }

    function renderShot(item) {
      var card = doc.createElement('div');
      card.className = 'tool-shot';
      var img = doc.createElement('img');
      img.src = item.url;
      img.alt = '第 ' + item.page + ' 页';
      img.loading = 'lazy';
      img.decoding = 'async';
      var b = doc.createElement('div');
      b.className = 'tool-shot_bar';
      var s = doc.createElement('span');
      s.textContent = '第 ' + item.page + ' 页 · ' + fmtSize(item.size);
      var dl = doc.createElement('a');
      dl.className = 'tool-shot_dl';
      dl.href = item.url;
      dl.download = item.name;
      dl.textContent = '下载';
      b.appendChild(s); b.appendChild(dl);
      card.appendChild(img); card.appendChild(b);
      return card;
    }

    run.addEventListener('click', function () {
      if (!file || !pages) return;
      var type = fmt.value;
      var q = Math.max(0.4, Math.min(1, (parseInt(quality.value, 10) || 85) / 100));
      var k = parseFloat(scale.value) || 2;
      var list = parseRange(rangeInput.value, pages);
      if (!list.length) { say(note, '页范围没解析出有效页码（文档共 ' + pages + ' 页）', true); return; }

      run.disabled = true;
      out.innerHTML = '';
      out.hidden = false;
      progress.hidden = false;
      bar.style.width = '0%';
      say(note, '转换中… 0 / ' + list.length);

      var base = (file.name.replace(/\.pdf$/i, '') || 'pdf');
      var idx = 0, failed = 0;

      function step() {
        if (idx >= list.length) {
          run.disabled = false;
          progress.hidden = true;
          say(note, failed
            ? '完成 ' + (list.length - failed) + ' 页，失败 ' + failed + ' 页。'
            : '全部完成，共 ' + list.length + ' 页。');
          return;
        }
        var pageNo = list[idx];
        var ready = pdfDoc ? Promise.resolve(pdfDoc) : readBytes(file).then(function (u8) {
          return loadLib().then(function (lib) { return lib.getDocument({ data: u8 }).promise; });
        });
        ready.then(function (pdf) { return pdf.getPage(pageNo); }).then(function (page) {
          var viewport = page.getViewport({ scale: k });
          var dpr = Math.min(2, window.devicePixelRatio || 1);
          var cv = doc.createElement('canvas');
          cv.width = Math.floor(viewport.width * dpr);
          cv.height = Math.floor(viewport.height * dpr);
          var ctx = cv.getContext('2d');
          if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
          return page.render({ canvasContext: ctx, viewport: viewport, transform: [dpr, 0, 0, dpr, 0, 0] }).promise
            .then(function () {
              return new Promise(function (res) {
                cv.toBlob(function (blob) {
                  if (blob) res(blob);
                  else cv.toBlob(function (b2) { res(b2); }, 'image/png');
                }, type, type === 'image/png' ? undefined : q);
              });
            })
            .then(function (blob) {
              if (!blob) throw new Error('编码失败');
              var ext = type === 'image/png' ? 'png' : 'jpg';
              out.appendChild(renderShot({
                page: pageNo,
                size: blob.size,
                url: URL.createObjectURL(blob),
                name: base + '-p' + pageNo + '.' + ext
              }));
            });
        }).catch(function () {
          failed++;
        }).then(function () {
          idx++;
          bar.style.width = Math.round(idx / list.length * 100) + '%';
          say(note, '转换中… ' + idx + ' / ' + list.length);
          step();
        });
      }
      step();
    });
  })();
})();
