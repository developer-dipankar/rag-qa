import puppeteer from 'puppeteer';
import fs from 'fs';

const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body { margin: 0; padding: 40px; background: #0d1117; display: flex; justify-content: center; }
    .mermaid { background: #0d1117; }
  </style>
</head>
<body>
  <div class="mermaid">
    flowchart TB
      subgraph inputs["📥 Input Files"]
        blue["📘 Blue CSV<br/>Baseline Logs"]
        green["📗 Green CSV<br/>Validation Logs"]
      end
      
      subgraph traceiq["🔍 Trace IQ Engine"]
        comparator["📊 Log Comparator<br/>Pattern Matching & Diff"]
        analyzer["🧠 Error Analyzer<br/>Classification & Scoring"]
      end
      
      subgraph ai["🤖 AI Layer"]
        ollama["🦙 Ollama<br/>Llama 3 8B"]
        repos["📂 Code Repositories<br/>Context Provider"]
      end
      
      output["📋 Analysis Report<br/>Root Cause • Recommendations • Confidence"]
      
      blue --> comparator
      green --> comparator
      comparator --> analyzer
      analyzer --> ollama
      repos --> ollama
      ollama --> output
      
      style blue fill:#1f6feb,stroke:#388bfd,color:#fff
      style green fill:#238636,stroke:#2ea043,color:#fff
      style comparator fill:#a371f7,stroke:#8957e5,color:#fff
      style analyzer fill:#a371f7,stroke:#8957e5,color:#fff
      style ollama fill:#f0883e,stroke:#d18616,color:#fff
      style repos fill:#21262d,stroke:#30363d,color:#c9d1d9
      style output fill:#238636,stroke:#2ea043,color:#fff
      style inputs fill:#161b22,stroke:#30363d,color:#c9d1d9
      style traceiq fill:#161b22,stroke:#a371f7,color:#c9d1d9
      style ai fill:#161b22,stroke:#f0883e,color:#c9d1d9
  </div>
  <script>
    mermaid.initialize({ 
      startOnLoad: true, 
      theme: 'dark',
      themeVariables: {
        background: '#0d1117',
        primaryColor: '#238636',
        primaryTextColor: '#c9d1d9',
        lineColor: '#30363d'
      }
    });
  </script>
</body>
</html>
`;

async function generateDiagram() {
  console.log('🎨 Generating architecture diagram...');
  
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.setContent(html);
  await page.setViewport({ width: 1200, height: 800 });
  
  // Wait for mermaid to render
  await page.waitForSelector('.mermaid svg', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1000)); // Extra wait for rendering
  
  // Get the mermaid element bounds
  const element = await page.$('.mermaid');
  const box = await element.boundingBox();
  
  // Screenshot with padding
  await page.screenshot({
    path: 'architecture_diagram.png',
    clip: {
      x: Math.max(0, box.x - 20),
      y: Math.max(0, box.y - 20),
      width: box.width + 40,
      height: box.height + 40
    }
  });
  
  await browser.close();
  console.log('✅ Saved: architecture_diagram.png');
}

generateDiagram().catch(console.error);

