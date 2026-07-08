/** 
 * MJR Export Utilities
 * Exports the AI Assistant's LATEST answer as a clean one-page report
 * (PDF / Excel / Word) — NOT the whole chat history or the user's questions.
 * Libraries (jsPDF, SheetJS) are loaded on demand to keep page load fast.
 */
(function () { 

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    function getPageName() {
        var path = (window.location.pathname.split('/').pop() || 'dashboard').replace('.html', '');
        return path.charAt(0).toUpperCase() + path.slice(1).replace(/-/g, ' ');
    }

    function getTimestamp() {
        return new Date().toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    }

    function getFilename(ext) {
        var page = getPageName().toLowerCase().replace(/\s+/g, '-');
        var date = new Date().toISOString().slice(0, 10);
        return 'ai-report-' + page + '-' + date + '.' + ext;
    }

    // The report content = only the most recent AI Assistant answer, as plain
    // text lines. We deliberately skip the greeting, the typing indicator,
    // the suggestion chips, and every "You" (user) message, so the export is
    // the answer itself — not the conversation.
    function getReportLines() {
        var chatBody = document.getElementById('aiChatBody');
        if (!chatBody) return [];
        var aiNodes = [];
        chatBody.querySelectorAll('.chat-msg.ai').forEach(function (el) {
            if (el.id === 'ai-typing-indicator' || el.id === 'aiGreeting') return;
            if (el.classList.contains('ai-suggestions-container')) return;
            aiNodes.push(el);
        });
        if (!aiNodes.length) return [];
        var last = aiNodes[aiNodes.length - 1];
        var raw = (last.innerText || last.textContent || '').trim();
        // Collapse blank runs, keep meaningful lines.
        return raw.split('\n').map(function (l) { return l.replace(/\s+$/, ''); })
            .filter(function (l, i, a) { return l.trim() !== '' || (a[i - 1] && a[i - 1].trim() !== ''); });
    }

    function showToast(msg, type) {
        var existing = document.getElementById('mjr-export-toast');
        if (existing) existing.remove();
        var t = document.createElement('div');
        t.id = 'mjr-export-toast';
        t.textContent = msg;
        t.style.cssText = [
            'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
            'padding:10px 20px', 'border-radius:10px', 'font-size:0.875rem',
            'font-weight:600', 'z-index:99999', 'box-shadow:0 8px 24px rgba(0,0,0,0.18)',
            'color:#fff', 'pointer-events:none',
            'background:' + (type === 'error' ? '#ef4444' : '#10b981')
        ].join(';');
        document.body.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.remove(); }, 3000);
    }

    var NOTHING = 'Ask the AI a question first, then export its answer.';

    /* ── PDF ─────────────────────────────────────────────────────────────── */
    window.MJR_exportPDF = async function () {
        var lines = getReportLines();
        if (!lines.length) { showToast(NOTHING, 'error'); return; }

        try {
            showToast('Generating PDF…');
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

            var jsPDF = (window.jspdf || {}).jsPDF;
            if (!jsPDF) throw new Error('jsPDF failed to load.');

            var doc = new jsPDF({ unit: 'pt', format: 'a4' });
            var pw = doc.internal.pageSize.getWidth();
            var margin = 48;
            var maxW = pw - margin * 2;
            var y = margin;

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.setTextColor(37, 99, 235);
            doc.text('AI Assistant Report', margin, y);
            y += 22;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            doc.text('Page: ' + getPageName() + '   |   Generated: ' + getTimestamp(), margin, y);
            y += 16;

            doc.setDrawColor(203, 213, 225);
            doc.line(margin, y, pw - margin, y);
            y += 20;

            doc.setFontSize(10.5);
            doc.setTextColor(30, 41, 59);
            lines.forEach(function (line) {
                var isBullet = /^[-*•]\s+/.test(line.trim());
                var text = isBullet ? '•  ' + line.trim().replace(/^[-*•]\s+/, '') : line;
                var indent = isBullet ? margin + 8 : margin;
                doc.setFont('helvetica', isBullet ? 'normal' : (line === line.toUpperCase() && line.trim() ? 'bold' : 'normal'));
                var wrapped = doc.splitTextToSize(text, maxW - (isBullet ? 8 : 0));
                wrapped.forEach(function (w) {
                    if (y > 780) { doc.addPage(); y = margin; }
                    doc.text(w, indent, y);
                    y += 14;
                });
            });

            doc.save(getFilename('pdf'));
            showToast('PDF exported!');
        } catch (e) {
            showToast('PDF export failed: ' + e.message, 'error');
        }
    };

    /* ── Excel ───────────────────────────────────────────────────────────── */
    window.MJR_exportExcel = async function () {
        var lines = getReportLines();
        if (!lines.length) { showToast(NOTHING, 'error'); return; }

        try {
            showToast('Generating Excel…');
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

            var XLSX = window.XLSX;
            if (!XLSX) throw new Error('SheetJS failed to load.');

            var wb = XLSX.utils.book_new();
            var rows = [['AI Assistant Report'], ['Page: ' + getPageName() + '  |  Generated: ' + getTimestamp()], []];
            lines.forEach(function (l) { rows.push([l.replace(/^[-*•]\s+/, '• ')]); });
            var ws = XLSX.utils.aoa_to_sheet(rows);
            autoFitColumns(XLSX, ws);
            XLSX.utils.book_append_sheet(wb, ws, 'AI Report');

            XLSX.writeFile(wb, getFilename('xlsx'));
            showToast('Excel exported!');
        } catch (e) {
            showToast('Excel export failed: ' + e.message, 'error');
        }
    };

    /* ── Shared helpers (used by inline exports on other pages) ────────── */
    window.loadSheetJS = function () {
        return loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    };

    function autoFitColumns(XLSX, ws, minWidth) {
        if (!ws['!ref']) return;
        var range = XLSX.utils.decode_range(ws['!ref']);
        var colWidths = [];
        for (var C = range.s.c; C <= range.e.c; C++) {
            var maxLen = 0;
            for (var R = range.s.r; R <= range.e.r; R++) {
                var cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
                if (cell && cell.v !== undefined) {
                    var len = String(cell.v).length;
                    if (len > maxLen) maxLen = len;
                }
            }
            colWidths[C] = { wch: Math.max(minWidth || 10, maxLen + 3) };
        }
        ws['!cols'] = colWidths;
    }
    window.autoFitColumns = autoFitColumns;

    /* ── Professional sheet formatting ──────────────────────────────────── */
    window.formatExcelSheet = function (XLSX, ws, opts) {
        if (!ws['!ref']) return;
        opts = opts || {};
        var freezeRow = opts.freezeRow !== undefined ? opts.freezeRow : 0;
        var headerRow = opts.headerRow !== undefined ? opts.headerRow : 0;
        var range = XLSX.utils.decode_range(ws['!ref']);

        // Freeze panes (header row)
        if (freezeRow >= 0) {
            ws['!freeze'] = { xSplit: 0, ySplit: freezeRow + 1, activePane: 'bottomLeft' };
        }

        // Style header row
        if (headerRow >= 0 && headerRow <= range.e.r) {
            var fill = { fgColor: { rgb: '1E40AF' } };
            var font = { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' };
            var alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
            var border = {
                top: { style: 'thin', color: { rgb: 'E2E8F0' } },
                bottom: { style: 'medium', color: { rgb: '1E40AF' } },
                left: { style: 'thin', color: { rgb: 'E2E8F0' } },
                right: { style: 'thin', color: { rgb: 'E2E8F0' } }
            };
            for (var C = range.s.c; C <= range.e.c; C++) {
                var addr = XLSX.utils.encode_cell({ r: headerRow, c: C });
                if (!ws[addr]) ws[addr] = { v: '', t: 's' };
                ws[addr].s = { fill: fill, font: font, alignment: alignment, border: border };
            }
        }

        // Data row styling
        var dataBorder = {
            top: { style: 'thin', color: { rgb: 'E2E8F0' } },
            bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
            left: { style: 'thin', color: { rgb: 'E2E8F0' } },
            right: { style: 'thin', color: { rgb: 'E2E8F0' } }
        };
        var dataFont = { sz: 10, name: 'Calibri', color: { rgb: '334155' } };
        var dataAlignment = { vertical: 'center' };
        for (var R = headerRow + 1; R <= range.e.r; R++) {
            for (var C = range.s.c; C <= range.e.c; C++) {
                var addr2 = XLSX.utils.encode_cell({ r: R, c: C });
                if (ws[addr2]) {
                    ws[addr2].s = {
                        font: dataFont,
                        alignment: dataAlignment,
                        border: dataBorder
                    };
                }
            }
        }

        // Alternate row shading
        for (var R2 = headerRow + 2; R2 <= range.e.r; R2 += 2) {
            for (var C2 = range.s.c; C2 <= range.e.c; C2++) {
                var addr3 = XLSX.utils.encode_cell({ r: R2, c: C2 });
                if (ws[addr3]) {
                    if (!ws[addr3].s) ws[addr3].s = {};
                    if (!ws[addr3].s.fill) ws[addr3].s.fill = {};
                    ws[addr3].s.fill.fgColor = { rgb: 'F8FAFC' };
                }
            }
        }
    };

    /* ── DOCX (Word-compatible HTML blob) ────────────────────────────────── */
    window.MJR_exportDOCS = function () {
        var lines = getReportLines();
        if (!lines.length) { showToast(NOTHING, 'error'); return; }

        try {
            var body = lines.map(function (line) {
                var t = line.trim();
                if (t === '') return '<div style="height:6pt;"></div>';
                var esc = function (s) { return s.replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
                if (/^[-*•]\s+/.test(t)) {
                    return '<div style="font-size:10.5pt;line-height:1.5;margin-left:16pt;">&bull;&nbsp;' + esc(t.replace(/^[-*•]\s+/, '')) + '</div>';
                }
                if (t === t.toUpperCase()) {
                    return '<div style="font-size:11pt;font-weight:bold;color:#0f172a;margin-top:6pt;">' + esc(t) + '</div>';
                }
                return '<div style="font-size:10.5pt;line-height:1.5;">' + esc(t) + '</div>';
            }).join('');

            var html = '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office"'
                + ' xmlns:w="urn:schemas-microsoft-com:office:word"'
                + ' xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">'
                + '<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1e293b;margin:72pt;}'
                + 'h1{color:#2563eb;font-size:18pt;margin-bottom:4pt;}'
                + '.meta{color:#64748b;font-size:9pt;margin-bottom:16pt;}'
                + 'hr{border:none;border-top:1px solid #cbd5e1;margin:12pt 0;}'
                + '</style></head><body>'
                + '<h1>AI Assistant Report</h1>'
                + '<div class="meta">Page: ' + getPageName() + ' &nbsp;|&nbsp; Generated: ' + getTimestamp() + '</div>'
                + '<hr>'
                + body
                + '</body></html>';

            var blob = new Blob(['﻿', html], { type: 'application/msword' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = getFilename('doc');
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            showToast('Word document exported!');
        } catch (e) {
            showToast('DOCX export failed: ' + e.message, 'error');
        }
    };

})();
