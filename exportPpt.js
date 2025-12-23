import PptxGenJS from 'pptxgenjs';

// Create presentation
const pptx = new PptxGenJS();
pptx.title = 'Trace IQ - AI-Powered Log Analysis';
pptx.author = 'Team Quantum Coders';
pptx.company = 'Quantum Coders';

// Define colors
const DARK_BG = '0d1117';
const GREEN = '7ee787';
const ORANGE = 'ffa657';
const WHITE = 'c9d1d9';
const GRAY = '8b949e';

// Slide 1: Title
let slide = pptx.addSlide();
slide.background = { color: DARK_BG };
slide.addText('🔍 Trace IQ', { x: 0.5, y: 2, w: '90%', h: 1, fontSize: 48, color: GREEN, bold: true, align: 'center' });
slide.addText('AI-Powered Log Analysis & Regression Detection', { x: 0.5, y: 3.2, w: '90%', h: 0.6, fontSize: 24, color: ORANGE, align: 'center' });
slide.addText('🚀 Team: Quantum Coders', { x: 0.5, y: 4.2, w: '90%', h: 0.5, fontSize: 20, color: 'ff7b72', align: 'center' });

// Slide 2: Problem Statement
slide = pptx.addSlide();
slide.background = { color: DARK_BG };
slide.addText('🎯 The Problem', { x: 0.5, y: 0.5, w: '90%', h: 0.8, fontSize: 32, color: GREEN, bold: true });
const problems = [
  'Manual log analysis is time-consuming',
  'Hard to pinpoint issues across Server, ML App, or Alloy Teams',
  'Regression detection requires extensive manual effort',
  'No standardized way to compare workflow executions'
];
problems.forEach((p, i) => {
  slide.addText(`• ${p}`, { x: 0.7, y: 1.6 + i * 0.7, w: '85%', h: 0.6, fontSize: 20, color: WHITE });
});

// Slide 3: Solution
slide = pptx.addSlide();
slide.background = { color: DARK_BG };
slide.addText('💡 Our Solution', { x: 0.5, y: 0.5, w: '90%', h: 0.8, fontSize: 32, color: GREEN, bold: true });
slide.addText('Trace IQ - An intelligent log analysis tool that:', { x: 0.5, y: 1.3, w: '90%', h: 0.5, fontSize: 20, color: WHITE, bold: true });
const solutions = [
  'Compares Blue-Green workflow logs automatically',
  'Uses AI-powered analysis (Llama 3 8B)',
  'Provides root cause identification for errors',
  'Detects regressions between baseline and validation',
  'Functional workflow check with code repository integration'
];
solutions.forEach((s, i) => {
  slide.addText(`• ${s}`, { x: 0.7, y: 1.9 + i * 0.6, w: '85%', h: 0.5, fontSize: 18, color: WHITE });
});

// Slide 4: Architecture (using generated image)
slide = pptx.addSlide();
slide.background = { color: DARK_BG };
slide.addText('🏗️ Architecture', { x: 0.5, y: 0.3, w: '90%', h: 0.6, fontSize: 32, color: GREEN, bold: true });
// Add the architecture diagram image
slide.addImage({ path: 'architecture_diagram.png', x: 0.5, y: 1.0, w: 9, h: 4.3, sizing: { type: 'contain', w: 9, h: 4.3 } });

// Slide 5: Root Cause Identification
slide = pptx.addSlide();
slide.background = { color: DARK_BG };
slide.addText('🎯 Easy Root Cause Identification', { x: 0.5, y: 0.5, w: '90%', h: 0.8, fontSize: 28, color: GREEN, bold: true });
slide.addText('Pinpoint issues across Server, ML App, or Alloy Teams', { x: 0.5, y: 1.2, w: '90%', h: 0.4, fontSize: 16, color: GRAY, italic: true });
const benefits1 = [
  'Detects error patterns from different services',
  'Correlates failures with specific code files',
  'Provides exact CSV line numbers',
  'Categorizes errors (NULL_STATE, EXCEPTION, SESSION_ERROR)'
];
benefits1.forEach((b, i) => {
  slide.addText(`• ${b}`, { x: 0.7, y: 1.8 + i * 0.6, w: '85%', h: 0.5, fontSize: 18, color: WHITE });
});

// Slide 6: Faster & Efficient
slide = pptx.addSlide();
slide.background = { color: DARK_BG };
slide.addText('⚡ Faster and More Efficient', { x: 0.5, y: 0.5, w: '90%', h: 0.8, fontSize: 28, color: GREEN, bold: true });
slide.addText('Reduce debugging time from hours to minutes', { x: 0.5, y: 1.2, w: '90%', h: 0.4, fontSize: 16, color: GRAY, italic: true });
const benefits2 = [
  'Automated Analysis - No manual log parsing',
  'Intelligent Scoring - High-confidence errors prioritized',
  'Repository Context - AI understands your codebase',
  'One Command - Get comprehensive analysis instantly'
];
benefits2.forEach((b, i) => {
  slide.addText(`• ${b}`, { x: 0.7, y: 1.8 + i * 0.6, w: '85%', h: 0.5, fontSize: 18, color: WHITE });
});

// Slide 7: Secure & Private
slide = pptx.addSlide();
slide.background = { color: DARK_BG };
slide.addText('🔒 Secure & Private', { x: 0.5, y: 0.5, w: '90%', h: 0.8, fontSize: 28, color: GREEN, bold: true });
slide.addText('Your data never leaves your environment', { x: 0.5, y: 1.2, w: '90%', h: 0.4, fontSize: 16, color: GRAY, italic: true });
const benefits3 = [
  'Offline AI Model - Local Llama 3 via Ollama',
  'No Data Exposure - Stays within infrastructure',
  'No API Keys - Self-contained solution',
  'Compliance Friendly - Meets privacy requirements'
];
benefits3.forEach((b, i) => {
  slide.addText(`• ${b}`, { x: 0.7, y: 1.8 + i * 0.6, w: '85%', h: 0.5, fontSize: 18, color: WHITE });
});

// Slide 8: Sample Output
slide = pptx.addSlide();
slide.background = { color: DARK_BG };
slide.addText('🖥️ Sample Output', { x: 0.5, y: 0.5, w: '90%', h: 0.8, fontSize: 28, color: GREEN, bold: true });
const sampleOutput = `### Root Cause Suggestions:

1. Line 35 in green.csv:
   • Error: Session variable failure
   • Related file: adk-services/config/adk.yml

2. Line 72 in green.csv:
   • Error: Message delivery timeout
   • Related file: moviusConnectTeams/src/SIP/MessageUtil.ts

### Confidence Level: HIGH`;
slide.addText(sampleOutput, { x: 0.5, y: 1.4, w: '90%', h: 4, fontSize: 14, color: WHITE, fontFace: 'Courier New', fill: { color: '161b22' }, margin: 20 });

// Slide 9: Future Proposals
slide = pptx.addSlide();
slide.background = { color: DARK_BG };
slide.addText('🔮 Future Proposals', { x: 0.5, y: 0.5, w: '90%', h: 0.8, fontSize: 28, color: GREEN, bold: true });
const proposals = [
  'Regression Automation Testing - CI/CD integration',
  'ELK API Integration - Direct log fetching',
  'Web Dashboard - Interactive UI, error heatmaps',
  'Alert System - Slack/Teams notifications',
  'Multi-Workflow Support - Compare multiple workflows',
  'Multi-Baseline Comparison - Multiple blue files'
];
proposals.forEach((p, i) => {
  slide.addText(`• ${p}`, { x: 0.7, y: 1.4 + i * 0.55, w: '85%', h: 0.5, fontSize: 16, color: WHITE });
});

// Slide 10: Thank You
slide = pptx.addSlide();
slide.background = { color: DARK_BG };
slide.addText('Thank You!', { x: 0.5, y: 1.8, w: '90%', h: 1, fontSize: 48, color: GREEN, bold: true, align: 'center' });
slide.addText('🚀 Team Quantum Coders', { x: 0.5, y: 3.2, w: '90%', h: 0.6, fontSize: 28, color: 'ff7b72', align: 'center' });

// Save the file
const filename = 'TraceIQ_Presentation.pptx';
pptx.writeFile({ fileName: filename })
  .then(() => console.log(`✅ PowerPoint exported: ${filename}`))
  .catch(err => console.error('Error:', err));

