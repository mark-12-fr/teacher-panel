/**
 * MJR Export Utilities
 * Provides PDF, Excel, and DOCX export of the AI chat conversation.
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

    function getChatMessages() {
        var chatBody = document.getElementById('aiChatBody');
        if (!chatBody) return [];
        var msgs = [];
        chatBody.querySelectorAll('.chat-msg').forEach(function (el) {
            if (el.id === 'ai-typing-indicator' || el.id === 'aiGreeting') return;
            if (el.classList.contains('ai-suggestions-container')) return;
            msgs.push({
                role: el.classList.contains('user') ? 'You' : 'AI Assistant',
                text: (el.innerText || el.textContent || '').trim()
            });
        });
        return msgs;
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

    /* ── PDF ─────────────────────────────────────────────────────────────── */
    window.MJR_exportPDF = async function () {
        var msgs = getChatMessages();
        if (!msgs.length) { showToast('No conversation to export yet.', 'error'); return; }

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

            // ── Title
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.setTextColor(37, 99, 235);
            doc.text('AI Assistant Report', margin, y);
            y += 22;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            doc.text('Page: ' + getPageName() + '   |   Exported: ' + getTimestamp(), margin, y);
            y += 16;

            doc.setDrawColor(203, 213, 225);
            doc.line(margin, y, pw - margin, y);
            y += 18;

            msgs.forEach(function (m) {
                var isUser = m.role === 'You';

                if (y > 760) { doc.addPage(); y = margin; }

                // Role badge
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8.5);
                doc.setTextColor(isUser ? 37 : 16, isUser ? 99 : 185, isUser ? 235 : 129);
                doc.text(m.role.toUpperCase(), margin, y);
                y += 13;

                // Message body
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(10);
                doc.setTextColor(30, 41, 59);

                var lines = doc.splitTextToSize(m.text, maxW);
                lines.forEach(function (line) {
                    if (y > 770) { doc.addPage(); y = margin; }
                    doc.text(line, margin, y);
                    y += 13;
                });
                y += 10;
            });

            doc.save(getFilename('pdf'));
            showToast('PDF exported!');
        } catch (e) {
            showToast('PDF export failed: ' + e.message, 'error');
        }
    };

    /* ── Excel ───────────────────────────────────────────────────────────── */
    window.MJR_exportExcel = async function () {
        var msgs = getChatMessages();
        if (!msgs.length) { showToast('No conversation to export yet.', 'error'); return; }

        try {
            showToast('Generating Excel…');
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

            var XLSX = window.XLSX;
            if (!XLSX) throw new Error('SheetJS failed to load.');

            var wb = XLSX.utils.book_new();

            // Sheet 1 — Conversation
            var rows = [['Role', 'Message', 'Page', 'Exported At']];
            msgs.forEach(function (m) {
                rows.push([m.role, m.text, getPageName(), getTimestamp()]);
            });
            var ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{ wch: 16 }, { wch: 80 }, { wch: 22 }, { wch: 26 }];
            XLSX.utils.book_append_sheet(wb, ws, 'AI Conversation');

            XLSX.writeFile(wb, getFilename('xlsx'));
            showToast('Excel exported!');
        } catch (e) {
            showToast('Excel export failed: ' + e.message, 'error');
        }
    };

    /* ── DOCX (Word-compatible HTML blob) ────────────────────────────────── */
    window.MJR_exportDOCS = function () {
        var msgs = getChatMessages();
        if (!msgs.length) { showToast('No conversation to export yet.', 'error'); return; }

        try {
            var rows = msgs.map(function (m) {
                var isUser = m.role === 'You';
                var color = isUser ? '#2563eb' : '#059669';
                var bg = isUser ? '#eff6ff' : '#f0fdf4';
                return '<div style="margin-bottom:14pt;">'
                    + '<div style="font-size:9pt;font-weight:bold;color:' + color + ';margin-bottom:4pt;">' + m.role.toUpperCase() + '</div>'
                    + '<div style="font-size:10.5pt;line-height:1.6;background:' + bg + ';padding:10pt 14pt;border-radius:6pt;white-space:pre-wrap;">'
                    + m.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    + '</div></div>';
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
                + '<div class="meta">Page: ' + getPageName() + ' &nbsp;|&nbsp; Exported: ' + getTimestamp() + '</div>'
                + '<hr>'
                + rows
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
