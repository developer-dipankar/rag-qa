// File upload handling
document.querySelectorAll('.file-input-wrapper').forEach(wrapper => {
    const input = wrapper.querySelector('input[type="file"]');
    const fileNameEl = wrapper.querySelector('.file-name');
    
    ['dragenter', 'dragover'].forEach(e => {
        wrapper.addEventListener(e, (ev) => { ev.preventDefault(); wrapper.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(e => {
        wrapper.addEventListener(e, (ev) => { ev.preventDefault(); wrapper.classList.remove('dragover'); });
    });
    wrapper.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length) { input.files = files; fileNameEl.textContent = files[0].name; }
    });
    input.addEventListener('change', () => {
        if (input.files.length) fileNameEl.textContent = input.files[0].name;
    });
});

// Form submission with SSE for real-time progress
document.getElementById('analysisForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData();
    const blueFile = document.getElementById('blueFile').files[0];
    const greenFile = document.getElementById('greenFile').files[0];
    const useRag = document.getElementById('useRag').checked;
    const reposDir = document.getElementById('reposDir').value;

    if (!blueFile || !greenFile) { alert('Please upload both CSV files'); return; }

    formData.append('blueFile', blueFile);
    formData.append('greenFile', greenFile);
    formData.append('useRag', useRag);
    if (reposDir) formData.append('reposDir', reposDir);

    // Show loading
    document.getElementById('uploadForm').style.display = 'none';
    document.getElementById('loading').classList.add('active');
    document.getElementById('results').classList.remove('active');

    const progressLog = document.getElementById('progressLog');
    const loadingText = document.getElementById('loadingText');
    progressLog.innerHTML = '';
    loadingText.textContent = 'Starting analysis...';

    try {
        // Use fetch with ReadableStream for SSE
        const response = await fetch('/api/analyze', { method: 'POST', body: formData });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const event = JSON.parse(line.slice(6));
                        handleProgressEvent(event, progressLog, loadingText);
                        if (event.stage === 'complete' && event.data) {
                            finalResult = event.data;
                        }
                        if (event.stage === 'error') {
                            throw new Error(event.message);
                        }
                    } catch (parseErr) {
                        if (parseErr.message !== 'Unexpected end of JSON input') {
                            console.error('Parse error:', parseErr);
                        }
                    }
                }
            }
        }

        document.getElementById('loading').classList.remove('active');
        document.getElementById('results').classList.add('active');

        if (finalResult) {
            renderResults(finalResult);
        } else {
            renderError('No results received from server');
        }
    } catch (error) {
        document.getElementById('loading').classList.remove('active');
        document.getElementById('results').classList.add('active');
        renderError(error.message);
    }
});

function handleProgressEvent(event, progressLog, loadingText) {
    const { stage, message, data } = event;

    // Update main loading text based on stage
    const stageLabels = {
        'start': '🚀 Starting...',
        'reading': '📖 Reading CSV files...',
        'comparing': '🔍 Comparing logs...',
        'rag': '🤖 AI Analysis in progress...',
        'repo_scan': '📂 Scanning repositories...',
        'patterns': '🔍 Extracting patterns...',
        'files': '📁 Finding relevant files...',
        'file_detail': '📄 Repository context...',
        'complete': '✅ Complete!'
    };
    if (stageLabels[stage]) {
        loadingText.textContent = stageLabels[stage];
    }

    // Add to progress log with special formatting for repository files
    const logEntry = document.createElement('div');
    logEntry.className = `progress-entry progress-${stage}`;

    // Special formatting for file details
    if (stage === 'file_detail' && data) {
        logEntry.innerHTML = `
            <span class="progress-time">${new Date().toLocaleTimeString()}</span>
            <span class="repo-file">📄 <strong>${escapeHtml(data.repo)}</strong>/${escapeHtml(data.path)}</span>
            <span class="repo-score">(score: ${data.score})</span>
        `;
        logEntry.style.paddingLeft = '20px';
        logEntry.style.color = '#4CAF50';
    } else if (stage === 'file_patterns') {
        logEntry.innerHTML = `<span class="progress-time">${new Date().toLocaleTimeString()}</span> <span class="matched-patterns">${escapeHtml(message)}</span>`;
        logEntry.style.paddingLeft = '40px';
        logEntry.style.color = '#888';
        logEntry.style.fontSize = '0.85em';
    } else if (stage === 'patterns' && data) {
        logEntry.innerHTML = `
            <span class="progress-time">${new Date().toLocaleTimeString()}</span>
            ${escapeHtml(message)}
            <span class="pattern-sample" style="color: #888; font-size: 0.85em;"> [${data.sample?.join(', ') || ''}...]</span>
        `;
    } else if (stage === 'files') {
        logEntry.innerHTML = `<span class="progress-time">${new Date().toLocaleTimeString()}</span> <strong>${escapeHtml(message)}</strong>`;
        logEntry.style.color = '#2196F3';
    } else {
        logEntry.innerHTML = `<span class="progress-time">${new Date().toLocaleTimeString()}</span> ${escapeHtml(message)}`;
    }

    progressLog.appendChild(logEntry);
    progressLog.scrollTop = progressLog.scrollHeight;
}

function renderError(message) {
    document.getElementById('results').innerHTML = `
        <div class="results-header">
            <h2>❌ Error</h2>
            <button class="btn btn-back" onclick="location.reload()">← New Analysis</button>
        </div>
        <div class="error-box">
            <h3>Analysis Failed</h3>
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

function renderResults(data) {
    const { report, ragResult, blueCsvName, greenCsvName } = data;
    const summary = report.summary;
    const isMatch = summary.mismatchedCount === 0 && summary.blueOnlyCount === 0 && summary.greenOnlyCount === 0;
    
    let html = `
        <div class="results-header">
            <h2>${isMatch ? '✅' : '❌'} Analysis Results</h2>
            <button class="btn btn-back" onclick="location.reload()">← New Analysis</button>
        </div>
        <div class="summary-grid">
            <div class="summary-item match"><div class="value">${summary.matchedCount}</div><div class="label">Matched</div></div>
            <div class="summary-item mismatch"><div class="value">${summary.mismatchedCount}</div><div class="label">Mismatched</div></div>
            <div class="summary-item blue"><div class="value">${summary.blueOnlyCount}</div><div class="label">Blue Only</div></div>
            <div class="summary-item green"><div class="value">${summary.greenOnlyCount}</div><div class="label">Green Only</div></div>
        </div>
        <p style="text-align: center; margin-bottom: 20px;">
            <strong>📘 Blue:</strong> ${blueCsvName} (${summary.blueLogCount} entries) &nbsp;|&nbsp;
            <strong>📗 Green:</strong> ${greenCsvName} (${summary.greenLogCount} entries)
        </p>
    `;
    
    // AI Analysis
    if (ragResult && ragResult.analysis) {
        html += `<h3 class="section-title">🤖 AI-Powered Analysis</h3>`;
        html += `<div class="ai-analysis">${formatMarkdown(ragResult.analysis)}</div>`;
    }
    
    // Log Differences (show first 10)
    if (report.logDifferences && report.logDifferences.length > 0) {
        html += `<h3 class="section-title">📋 Log Differences (${report.logDifferences.length} total)</h3>`;
        const diffsToShow = report.logDifferences.slice(0, 10);
        diffsToShow.forEach((diff, i) => {
            html += `<div class="log-diff"><strong>Entry #${diff.index + 1}</strong><br>`;
            diff.differences.forEach(d => {
                html += `<span class="path">${d.path || 'root'}</span>: `;
                if (d.kind === 'E') {
                    html += `<span class="blue-val">${escapeHtml(String(d.blueValue))}</span> → <span class="green-val">${escapeHtml(String(d.greenValue))}</span>`;
                } else if (d.kind === 'N') {
                    html += `<span class="green-val">+ ${escapeHtml(String(d.greenValue))}</span>`;
                } else if (d.kind === 'D') {
                    html += `<span class="blue-val">- ${escapeHtml(String(d.blueValue))}</span>`;
                }
                html += '<br>';
            });
            html += '</div>';
        });
        if (report.logDifferences.length > 10) {
            html += `<p style="color: #8b949e; text-align: center;">... and ${report.logDifferences.length - 10} more differences</p>`;
        }
    }
    
    document.getElementById('results').innerHTML = html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMarkdown(text) {
    return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^### (.+)$/gm, '<h4 style="color:#7ee787;margin:15px 0 10px;">$1</h4>')
        .replace(/^## (.+)$/gm, '<h3 style="color:#58a6ff;margin:20px 0 10px;">$1</h3>')
        .replace(/^- (.+)$/gm, '• $1')
        .replace(/^\d+\. /gm, (m) => `<strong>${m}</strong>`);
}

