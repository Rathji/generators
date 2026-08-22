// SimAI — cozy AI startup simulator. Core definitions & pure state derivations.

export const EPOCHS = [
  { id: "scripted", name: "Scripted Age", emoji: "📟", years: "1995 – 2011", blurb: "Rule-based chatbots, decision trees and spam filters. Pattern matching is the state of the art." },
  { id: "deeplearning", name: "Deep Learning Boom", emoji: "🧠", years: "2012 – 2016", blurb: "Perceptrons awaken. ConvNets learn to see cats, LSTMs learn to babble." },
  { id: "transformer", name: "Transformer Era", emoji: "📚", years: "2017 – 2023", blurb: "Attention is all you need. Tokenizers, GPTs, diffusion, RLHF, RAG — the boom." },
  { id: "agentic", name: "Agentic Frontier", emoji: "🤖", years: "2024 +", blurb: "Tool-calling agents, swarms and frontier-scale MoE giants. The AIs get hands." },
];

export const RESEARCH = [
  { id: "decision-tree", name: "Decision Trees & Forests", epoch: 0, year: 1997, cost: 2, days: 3, req: [], desc: "Interpretable models for tabular data and spam.", unlocks: "Decision Tree model" },
  { id: "perceptron", name: "The Perceptron", epoch: 1, year: 2012, cost: 8, days: 4, req: [], desc: "A single artificial neuron learns a linear boundary.", unlocks: "Perceptron model" },
  { id: "neural-net", name: "Backprop & Deep Nets", epoch: 1, year: 2012, cost: 25, days: 5, req: ["perceptron"], desc: "Gradient descent through many layers.", unlocks: "MLP model, on-prem rack farm" },
  { id: "cnn", name: "Convolutional Vision Nets", epoch: 1, year: 2012, cost: 40, days: 5, req: ["neural-net"], desc: "Slide filters over pixels to see cats.", unlocks: "ConvNet vision model" },
  { id: "rnn", name: "Recurrent Nets & LSTMs", epoch: 1, year: 2013, cost: 40, days: 5, req: ["neural-net"], desc: "Sequences with memory cells.", unlocks: "LSTM language model" },
  { id: "transformer", name: "The Transformer (Attention)", epoch: 2, year: 2017, cost: 120, days: 7, req: ["rnn"], desc: "Attention is all you need.", unlocks: "Transformer model, colocation, data centers" },
  { id: "eval", name: "Eval Harness (MMLU/MATH/HumanEval)", epoch: 2, year: 2019, cost: 60, days: 6, req: ["transformer"], desc: "Standardized benchmarks to brag with.", unlocks: "Leaderboard, Evaluator agent" },
  { id: "gpt", name: "Generative Pretraining", epoch: 2, year: 2018, cost: 200, days: 10, req: ["transformer"], desc: "Next-token prediction at scale.", unlocks: "GPT model, TPU pods, Open-Sourcer agent" },
  { id: "bpe", name: "BPE Tokenizers & Datasets", epoch: 2, year: 2018, cost: 100, days: 6, req: ["gpt"], desc: "Subword tokenizers and clean byte-level vocab.", unlocks: "BPE tokenizer (data pipeline)" },
  { id: "embeddings", name: "Embeddings & Retrieval", epoch: 2, year: 2019, cost: 120, days: 8, req: ["transformer"], desc: "Map meaning into vectors.", unlocks: "Embedding model, Embeddings API" },
  { id: "spotmarket", name: "GPU Spot Market", epoch: 2, year: 2020, cost: 80, days: 6, req: ["transformer"], desc: "Rent spare cloud compute on the cheap.", unlocks: "Serverless cloud burst, Shipping agent" },
  { id: "diffusion", name: "Diffusion Image Generation", epoch: 2, year: 2020, cost: 450, days: 12, req: ["gpt"], desc: "Turn noise into art, iteratively.", unlocks: "Diffusion image model" },
  { id: "code", name: "Code Completion Models", epoch: 2, year: 2021, cost: 350, days: 10, req: ["gpt"], desc: "Transformers that autocomplete software.", unlocks: "Code model, Code API" },
  { id: "lora", name: "LoRA Fine-Tuning", epoch: 2, year: 2021, cost: 80, days: 6, req: ["gpt"], desc: "Cheap adapter weights for task tuning.", unlocks: "LoRA finetuning, Finetuner agent" },
  { id: "vlm", name: "Vision-Language Models", epoch: 3, year: 2021, cost: 600, days: 8, req: ["cnn", "gpt"], desc: "Connect pixels to words.", unlocks: "Vision-Language model" },
  { id: "rlhf", name: "RLHF & Chat Alignment", epoch: 2, year: 2022, cost: 300, days: 12, req: ["lora"], desc: "Train on human preferences. Say please.", unlocks: "Chat model, RLHF, synthetic distillation" },
  { id: "rag", name: "RAG Pipelines", epoch: 2, year: 2022, cost: 150, days: 8, req: ["embeddings"], desc: "Ground generations in your knowledge base.", unlocks: "RAG Pipeline platform" },
  { id: "tts", name: "Voice Synthesis & Cloning", epoch: 3, year: 2022, cost: 400, days: 10, req: ["gpt"], desc: "Speak with any voice.", unlocks: "Voice Clone model" },
  { id: "cot", name: "Chain-of-Thought Reasoning", epoch: 3, year: 2022, cost: 600, days: 12, req: ["rlhf"], desc: "Let models think step by step.", unlocks: "Reasoning model" },
  { id: "guardrails", name: "Guardrails & Red-Teaming", epoch: 3, year: 2024, cost: 250, days: 8, req: ["rlhf"], desc: "Alignment fences and security harnesses.", unlocks: "Fewer incidents, safer everything" },
  { id: "quantize", name: "Quantization & Cheap Inference", epoch: 3, year: 2024, cost: 300, days: 8, req: ["gpt"], desc: "Run 8-bit models on a toaster.", unlocks: "Half inference compute cost" },
  { id: "tools", name: "Tool-Calling Agents", epoch: 3, year: 2024, cost: 800, days: 15, req: ["cot"], desc: "Models that browse, code and act.", unlocks: "Agent model, Agent Platform" },
  { id: "swarm", name: "Agent Swarms", epoch: 3, year: 2024, cost: 1200, days: 20, req: ["tools"], desc: "Whole crews of agents working in parallel.", unlocks: "Agent Swarm Platform" },
  { id: "frontier", name: "Frontier-Scale Architectures (MoE)", epoch: 3, year: 2025, cost: 4000, days: 30, req: ["swarm", "vlm"], desc: "Billion-parameter experts at web scale.", unlocks: "Frontier model, quantum annealers, nuclear power" },
];

export const ARCHES = [
  { id: "rule-chat", name: "Rule-Based Chatbot", emoji: "📟", epoch: 0, req: null, gpu: 0, tok: 0.002, tier: 0, quality: 8, text: true, desc: "If user says X, reply with Y. Revolutionary." },
  { id: "spam", name: "Naive Bayes Spam Filter", emoji: "📭", epoch: 0, req: null, gpu: 0, tok: 0.002, tier: 0, quality: 10, text: true, desc: "Nigerian princes have met their match." },
  { id: "decision-tree", name: "Decision Tree", emoji: "🌳", epoch: 0, req: "decision-tree", gpu: 0, tok: 0.005, tier: 0, quality: 12, text: true, desc: "If age > 30 and income > 50k, approve the loan." },
  { id: "perceptron", name: "Perceptron", emoji: "🧠", epoch: 1, req: "perceptron", gpu: 100, tok: 0.02, tier: 1, quality: 18, text: true, desc: "One neuron, great expectations." },
  { id: "neural-net", name: "Multi-Layer Perceptron", emoji: "🔗", epoch: 1, req: "neural-net", gpu: 400, tok: 0.1, tier: 1, quality: 28, text: true, desc: "A few neurons and some backprop." },
  { id: "cnn", name: "Convolutional Vision Net", emoji: "👁️", epoch: 1, req: "cnn", gpu: 1500, tok: 0.5, tier: 2, quality: 42, image: true, desc: "Sees cats, dogs, and a surprising number of muffins." },
  { id: "lstm", name: "LSTM Language Model", emoji: "🔁", epoch: 1, req: "rnn", gpu: 2000, tok: 1, tier: 2, quality: 48, text: true, desc: "Generates plausible text and endless midnight rambles." },
  { id: "transformer", name: "Transformer LM (Base)", emoji: "📚", epoch: 2, req: "transformer", gpu: 15000, tok: 8, tier: 3, quality: 62, text: true, desc: "Attention. All. You. Need." },
  { id: "gpt", name: "Generative Pretrained Transformer", emoji: "🦜", epoch: 2, req: "gpt", gpu: 45000, tok: 25, tier: 3, quality: 70, text: true, desc: "Bigger, hungrier, constantly demanding more text." },
  { id: "embeddings", name: "Embedding Model", emoji: "🧲", epoch: 2, req: "embeddings", gpu: 8000, tok: 5, tier: 3, quality: 72, retrieval: true, desc: "Maps meaning into vectors you can measure with." },
  { id: "diffusion", name: "Diffusion Image Generator", emoji: "🎨", epoch: 2, req: "diffusion", gpu: 40000, tok: 20, tier: 4, quality: 76, image: true, desc: "Turns static into art. Everyone has six fingers." },
  { id: "code", name: "Code Completion Model", emoji: "⌨️", epoch: 2, req: "code", gpu: 40000, tok: 20, tier: 4, quality: 78, code: true, desc: "Autocompletes your bugs in real time." },
  { id: "tts", name: "Voice Clone", emoji: "🎙️", epoch: 3, req: "tts", gpu: 30000, tok: 10, tier: 4, quality: 74, voice: true, desc: "Your voice, but slightly unhinged." },
  { id: "vlm", name: "Vision-Language Model", emoji: "👀", epoch: 3, req: "vlm", gpu: 120000, tok: 50, tier: 4, quality: 80, image: true, text: true, desc: "Looks at a photo, describes the vibes." },
  { id: "chat", name: "Chat-Tuned Model (RLHF)", emoji: "💬", epoch: 2, req: "rlhf", gpu: 60000, tok: 40, tier: 4, quality: 84, text: true, chat: true, desc: "Polite, helpful, and mildly sycophantic." },
  { id: "reasoning", name: "Reasoning Model (CoT)", emoji: "🧮", epoch: 3, req: "cot", gpu: 400000, tok: 150, tier: 5, quality: 88, text: true, chat: true, reason: true, desc: "Thinks out loud for 47 steps before answering." },
  { id: "agent", name: "Tool-Calling Agent", emoji: "🦾", epoch: 3, req: "tools", gpu: 500000, tok: 200, tier: 5, quality: 89, text: true, chat: true, agent: true, desc: "Has a browser, a terminal, and opinions." },
  { id: "frontier", name: "Frontier-Scale Model", emoji: "🌌", epoch: 3, req: "frontier", gpu: 4000000, tok: 1500, tier: 6, quality: 94, text: true, chat: true, image: true, code: true, reason: true, agent: true, desc: "Everything everywhere all at once. Eats data centers for breakfast." },
];

export const PRODUCTS = [
  { id: "token-api", name: "Text Generation API", emoji: "💬", need: "text", mult: 1, gpuUse: 10, reqs: [], desc: "Sell tokens by the bucket." },
  { id: "chat-api", name: "Chat Assistant API", emoji: "🤖", need: "chat", mult: 1.6, gpuUse: 20, reqs: ["rlhf"], desc: "Sell pleasant conversation." },
  { id: "image-api", name: "Image Generation API", emoji: "🎨", need: "image", mult: 1.8, gpuUse: 30, reqs: [], desc: "Sell dreams (with watermark)." },
  { id: "voice-api", name: "Voice Clone API", emoji: "🎙️", need: "voice", mult: 1.4, gpuUse: 15, reqs: ["tts"], desc: "Sell celebrity audiobooks." },
  { id: "code-api", name: "Code Completion API", emoji: "⌨️", need: "code", mult: 1.6, gpuUse: 20, reqs: ["code"], desc: "Sell keystrokes." },
  { id: "embeddings-api", name: "Embeddings API", emoji: "🧲", need: "retrieval", mult: 1.4, gpuUse: 10, reqs: ["embeddings"], desc: "Sell vectors by the dozen." },
  { id: "rag-api", name: "RAG Pipeline Platform", emoji: "📎", need: "retrieval", mult: 1.5, gpuUse: 15, reqs: ["rag"], desc: "Sell grounded answers." },
  { id: "agent-api", name: "Agent Platform", emoji: "🦾", need: "agent", mult: 2.0, gpuUse: 40, reqs: ["tools"], desc: "Sell assistants with hands." },
  { id: "swarm-api", name: "Agent Swarm Platform", emoji: "🐝", need: "agent", mult: 2.6, gpuUse: 60, reqs: ["swarm"], desc: "Sell whole departments of agents." },
  { id: "consumer-app", name: "Consumer App", emoji: "📱", need: null, mult: 0.9, gpuUse: 5, reqs: [], desc: "Sell a fun little app." },
];

export const HARDWARE = [
  { id: "garage", name: "Garage Workstation", emoji: "🛠️", cost: 0, gpuH: 24, mw: 0.01, maint: 0, desc: "One GPU and a lot of hope." },
  { id: "rack", name: "GPU Rack (4x)", emoji: "🖥️", cost: 25, gpuH: 240, mw: 0.05, maint: 0.03, desc: "Four GPUs strapped to a shelf." },
  { id: "cluster", name: "GPU Cluster (16x)", emoji: "🗄️", cost: 200, gpuH: 960, mw: 0.3, maint: 0.3, desc: "A real cluster. The room is getting warm." },
  { id: "onprem", name: "On-Prem Rack Farm", emoji: "🏚️", cost: 800, gpuH: 4000, mw: 3, maint: 1, req: "neural-net", desc: "Racks in a repurposed warehouse." },
  { id: "colocation", name: "Colocation Cage", emoji: "🏢", cost: 300, gpuH: 2000, mw: 0.5, maint: 0.35, req: "transformer", desc: "Rent racks in someone else's data center." },
  { id: "tpu", name: "TPU Pod", emoji: "🧊", cost: 1500, gpuH: 8000, mw: 1.2, maint: 1.5, req: "gpt", desc: "Tensors, chilled." },
  { id: "quantum", name: "Quantum Annealer", emoji: "⚛️", cost: 5000, gpuH: 20000, mw: 5, maint: 5, req: "frontier", desc: "Computes in other timelines, mostly." },
];

export const BUILDINGS = [
  { id: "snack", name: "Snack Pantry", emoji: "🍿", cost: 3, morale: 3, desc: "Morale +3. Gummy bears fuel research." },
  { id: "standup", name: "Standup Board", emoji: "📋", cost: 2, morale: 1, train: 0.05, desc: "+5% training speed, +1 morale." },
  { id: "nap", name: "Nap Room", emoji: "😴", cost: 8, morale: 4, desc: "Morale +4. Sacred space." },
  { id: "devpod", name: "Dev Pod", emoji: "🛋️", cost: 10, product: 0.05, desc: "+5% product income." },
  { id: "git", name: "Git Repo & Issues", emoji: "🌿", cost: 5, quality: 0.03, desc: "+3% model quality." },
  { id: "ci", name: "CI Runner Farm", emoji: "⚙️", cost: 15, train: 0.1, desc: "+10% training speed." },
  { id: "hotaisle", name: "GPU Hot-Aisle Containment", emoji: "🌡️", cost: 20, cap: 0.1, desc: "+10% compute capacity." },
  { id: "mlops", name: "MLOps Pipeline", emoji: "🔁", cost: 80, autoClean: true, desc: "Doubles data processing capacity." },
  { id: "dojo", name: "RLHF Dojo", emoji: "🥋", cost: 120, quality: 0.05, desc: "+5% model quality." },
  { id: "boardroom", name: "Boardroom", emoji: "🪑", cost: 50, deal: 0.2, desc: "+20% chance of enterprise deals." },
  { id: "dcrack", name: "Data Center Server Rack", emoji: "🗄️", cost: 120, gpuH: 500, mw: 0.8, maint: 0.25, slot: true, req: "transformer", desc: "A rack in your own DC (+500 GPU-h/d). Limited by cooling." },
  { id: "cooling", name: "Cooling Tower", emoji: "🌬️", cost: 60, mw: 0.5, maint: 0.1, slotAdd: 1, req: "transformer", desc: "Adds a DC rack slot and 0.5 MW capacity." },
  { id: "generator", name: "Backup Generator", emoji: "🔋", cost: 150, mw: 20, maint: 0.2, req: "transformer", desc: "20 MW emergency power. Prevents outages." },
  { id: "hydro", name: "Hydroelectric Tie-In", emoji: "🌊", cost: 1200, mw: 50, req: "transformer", desc: "50 MW clean, free-ish power." },
  { id: "nuclear", name: "Off-Grid Nuclear Reactor", emoji: "☢️", cost: 8000, mw: 1000, req: "frontier", desc: "1000 MW. The neighbors are alarmed." },
];

export const STAFF = [
  { id: "annotator", name: "Data Annotator", emoji: "🏷️", salary: 0.08, req: null, role: "Cleans & labels data. Each +0.002 data quality (max 0.2)." },
  { id: "engineer", name: "ML Engineer", emoji: "👩‍💻", salary: 0.45, req: null, role: "Each -2% training compute (max 20%) and +1.5% model quality." },
  { id: "researcher", name: "AI Researcher", emoji: "🔬", salary: 0.55, req: null, role: "Each +25% research speed and +0.8% model quality." },
  { id: "prompter", name: "Prompt Whisperer", emoji: "🗣️", salary: 0.30, req: null, role: "Each +6% product income." },
  { id: "security", name: "Security Researcher", emoji: "🛡️", salary: 0.40, req: null, role: "Each -30% incident chance." },
  { id: "designer", name: "Product Designer", emoji: "🎨", salary: 0.35, req: null, role: "Each +8% product income." },
  { id: "sales", name: "Sales Rep", emoji: "📈", salary: 0.30, req: null, role: "Each +10% chance of enterprise contracts." },
  { id: "evaluator", name: "Evaluator Agent", emoji: "📝", salary: 0.15, req: "eval", agent: true, role: "Auto-scores models and pumps your reputation." },
  { id: "shipping", name: "Shipping Agent", emoji: "📦", salary: 0.20, req: "spotmarket", agent: true, role: "Auto-sells spare tokens & GPU-hours on the spot market." },
  { id: "finetuner", name: "Finetuner Agent", emoji: "🧵", salary: 0.20, req: "lora", agent: true, role: "Auto-runs LoRA adapters on your best model." },
  { id: "opensourcer", name: "Open-Sourcer Agent", emoji: "🌐", salary: 0.15, req: "gpt", agent: true, role: "Auto-releases old checkpoints to the community." },
];

export const DATA_UPGRADES = [
  { id: "quality", name: "Quality Filters", emoji: "🧹", cost: 15, req: null, quality: 0.10, cap: 0.6, desc: "Perplexity + fuzzy filtering. +0.10 data quality." },
  { id: "dedup", name: "Deduplication", emoji: "🪞", cost: 40, req: null, quality: 0.12, cap: 0.6, desc: "Near-exact & line-level dedup. +0.12 quality." },
  { id: "tokenizer", name: "BPE Tokenizer", emoji: "🔤", cost: 60, req: "bpe", quality: 0.12, cap: 0.6, desc: "+0.12 quality, +0.6G/day processing capacity." },
  { id: "pii", name: "PII Scrubbing", emoji: "🔒", cost: 80, req: null, quality: 0.08, safety: true, desc: "Removes personal data. Prevents data-leak lawsuits." },
  { id: "moderation", name: "Content Moderation", emoji: "🚫", cost: 150, req: null, quality: 0.08, safety: true, desc: "Filters toxic web content. Prevents rogue-model PR disasters." },
  { id: "flywheel", name: "Data Flywheel", emoji: "🔄", cost: 250, req: "gpt", flywheel: true, desc: "Products feed de-identified user data back: +0.01G clean/day per product." },
  { id: "distill", name: "Synthetic Data Distillation", emoji: "🧪", cost: 500, req: "rlhf", synth: true, desc: "Your models distill clean data: +0.05G/day, +0.03 quality." },
  { id: "crawlfleet", name: "Distributed Crawler Fleet", emoji: "🕸️", cost: 50, req: null, rawPerDay: 2.5, desc: "+2.5G raw tokens/day from a bot army." },
  { id: "partnership", name: "Web-Scale Crawl Partnership", emoji: "🤝", cost: 300, req: "gpt", rawPerDay: 15, desc: "+15G raw tokens/day via licensed partnerships." },
];

export const DATAPACKS = [
  { id: "cc", name: "Common Crawl Scrap", emoji: "🌐", cost: 10, raw: 5, quality: 0, desc: "5G raw web junk, straight from the crawl." },
  { id: "wiki", name: "Curated Wikipedia Dump", emoji: "📖", cost: 20, clean: 1, quality: 0.6, desc: "1G clean, encyclopedic, mildly opinionated." },
  { id: "news", name: "Licensed News Corpus", emoji: "🗞️", cost: 60, clean: 2, quality: 0.9, desc: "2G clean, professionally written, legally yours." },
  { id: "pref", name: "Human Preference Pairs", emoji: "👍", cost: 100, pref: 0.2, desc: "0.2G of ranked human feedback — needed for RLHF." },
];

export const ROUNDS = [
  { name: "Seed", val: 3, share: 0.10, desc: "Friends, family, and a pre-seed firm with strong opinions." },
  { name: "Series A", val: 15, share: 0.08, desc: "A real VC. They want growth and a bigger snack budget." },
  { name: "Series B", val: 60, share: 0.06, desc: "Two VCs and a sovereign fund who 'get it'." },
  { name: "Series C", val: 250, share: 0.05, desc: "The mega-funds arrive with term sheets and therapists." },
  { name: "Series D", val: 2000, share: 0.04, desc: "Late-stage money. The boardroom gets a second table." },
];

export const RIVALS = [
  { name: "Deepmindia", emoji: "🏔️", score: 8, growth: 0.10 },
  { name: "OpenBrains", emoji: "🧠", score: 12, growth: 0.14 },
  { name: "Cerebrum Inc", emoji: "🌐", score: 18, growth: 0.20 },
  { name: "VastMind", emoji: "🚀", score: 25, growth: 0.28 },
];

export const SIZES = {
  tiny: { label: "Tiny", tokens: 0.3, compute: 0.5, computeF: 0.85 },
  standard: { label: "Standard", tokens: 1, compute: 1, computeF: 1 },
  massive: { label: "Massive", tokens: 3, compute: 3, computeF: 1.15 },
};

export const NAME_SUFFIXES = ["Mk I", "Mk II", "Mk III", "Mk IV", "Mk V", "Omega", "Prime", "Ultra", "Neo", "Max"];

export const CONTRACT_TEMPLATES = [
  { name: "Enterprise Pilot", base: 80, days: 14 },
  { name: "Fintech Compliance Suite", base: 200, days: 18 },
  { name: "Gov Cloud Deal", base: 400, days: 21 },
  { name: "Auto Giant Integration", base: 900, days: 28 },
  { name: "Healthcare Assistant Rollout", base: 600, days: 24 },
];

export const FLAVOR_NEWS = [
  "The local GPU scalper has been seen weeping outside your office.",
  "A leaked memo reveals your rival feeds models on expired compute.",
  "Venture podcasts are 3x longer when they mention your startup.",
  "Your youngest intern asked why the GPUs 'hum like that'. Nobody knew.",
  "A subreddit called you 'the cozy lab' and it's been growing since.",
  "Your office plant was promoted to Senior Director of Vibes.",
  "The espresso machine unionized. You gave them a raise.",
  "An anonymous engineer blogs: 'I trained more models than I slept.'",
  "The data center next door played music too loud. Feud ongoing.",
  "Someone taped 'DO NOT PET THE GPUs' to the rack.",
  "A delivery drone crash-landed on your roof with pizza for a rival.",
  "The board suggested 'synergy'. You filed it under 'bad ideas'.",
];

export const GAME_LOSE_LOGS = [
  "Your GPU fans, at least, are resting.",
  "The snack pantry will be donated to a local shelter.",
  "Somewhere, a VC is disappointed you didn't pivot to blockchain.",
];

// --- lookups ---
export const RESEARCH_BY = Object.fromEntries(RESEARCH.map(r => [r.id, r]));
export const ARCH_BY = Object.fromEntries(ARCHES.map(a => [a.id, a]));
export const PRODUCT_BY = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
export const HARDWARE_BY = Object.fromEntries(HARDWARE.map(h => [h.id, h]));
export const BUILDING_BY = Object.fromEntries(BUILDINGS.map(b => [b.id, b]));
export const STAFF_BY = Object.fromEntries(STAFF.map(s => [s.id, s]));
export const DATAUP_BY = Object.fromEntries(DATA_UPGRADES.map(d => [d.id, d]));

// --- helpers ---
export function addLog(s, text) {
  s.log.push({ day: s.day, t: text });
  if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
}

export function productivity(s) {
  return Math.max(0.75, Math.min(1.15, 0.75 + 0.004 * s.morale));
}

export function moraleMods(s) {
  let m = 0;
  if (s.perks.snack) m += 6;
  if (s.perks.health) m += 8;
  if (s.perks.stock) m += 5;
  m += 3 * (s.buildings.snack || 0);
  m += 4 * (s.buildings.nap || 0);
  m += 1 * (s.buildings.standup || 0);
  return m;
}

export function staffTotal(s) { return Object.values(s.staff).reduce((a, b) => a + (b || 0), 0); }

export function buildingCount(s, id) { return s.buildings[id] || 0; }

export function dcSlots(s) { return 1 + (s.buildings.cooling || 0); }
export function dcRacks(s) { return s.buildings.dcrack || 0; }

export function energyUse(s) {
  let u = 0;
  for (const [id, q] of Object.entries(s.hardware)) u += (HARDWARE_BY[id].mw || 0) * q;
  for (const [id, q] of Object.entries(s.buildings)) u += (BUILDING_BY[id].mw || 0) * q;
  if (s.data.crawlerOn) u += 0.02;
  return u;
}

export function energyOwn(s) { return 50 * (s.buildings.hydro || 0) + 1000 * (s.buildings.nuclear || 0); }
export function energyGrid(s) { return Math.max(0, energyUse(s) - energyOwn(s)); }

export function uptime(s) {
  const use = energyUse(s);
  if (use <= 0) return 1;
  return Math.min(1, (energyOwn(s) + energyGrid(s)) / use);
}

export function computeCap(s) {
  let cap = 0;
  for (const [id, q] of Object.entries(s.hardware)) cap += (HARDWARE_BY[id].gpuH || 0) * q;
  for (const [id, q] of Object.entries(s.buildings)) cap += (BUILDING_BY[id].gpuH || 0) * q;
  cap *= 1 + 0.1 * buildingCount(s, "hotaisle");
  cap *= productivity(s);
  if (s.cloud.on) cap += 1000;
  if (s.flags.outageUntil > s.day) cap = 0;
  return cap;
}

export function quantFactor(s) { return s.researchDone.quantize ? 0.5 : 1; }

export function inferenceUse(s) {
  let u = 0;
  for (const p of s.products) u += PRODUCT_BY[p.type].gpuUse;
  return u * quantFactor(s);
}

export function crawlerUse(s) { return s.data.crawlerOn ? 10 : 0; }

export function trainingUse(s) {
  let u = 0;
  for (const j of s.jobs) if (j.rate > 0 && !j.finished) u += Math.min(j.rate, computeCap(s) - u);
  return u;
}

export function freeCompute(s) {
  return Math.max(0, computeCap(s) - inferenceUse(s) - crawlerUse(s) - trainingUse(s));
}

export function rawPerDay(s) {
  if (!s.data.crawlerOn) return 0;
  let r = 0.5;
  if (s.dataup.crawlfleet) r += 2.5;
  if (s.dataup.partnership) r += 15;
  if (s.flags.outageUntil > s.day) r = 0;
  return r;
}

export function processCapacity(s) {
  let c = 0.2;
  for (const [id] of Object.entries(s.dataup)) if (DATAUP_BY[id].cap) c += DATAUP_BY[id].cap;
  if (buildingCount(s, "mlops")) c *= 2;
  return c;
}

export function dataQuality(s) {
  let q = 0.3;
  for (const [id] of Object.entries(s.dataup)) if (DATAUP_BY[id].quality) q += DATAUP_BY[id].quality;
  q += Math.min(0.2, 0.002 * (s.staff.annotator || 0));
  if (s.dataup.distill) q += 0.03;
  if (s.dataup.flywheel) q += 0.02;
  return Math.min(1.2, q);
}

export function engineerReduction(s) { return 1 - 0.02 * Math.min(10, s.staff.engineer || 0); }
export function trainSpeedMult(s) {
  let m = 1 + 0.05 * buildingCount(s, "standup") + 0.1 * buildingCount(s, "ci");
  return m;
}

export function trainQuality(s, arch, size) {
  const dataF = 0.6 + dataQuality(s);
  const computeF = SIZES[size].computeF;
  const talentF = 1 + 0.015 * (s.staff.engineer || 0) + 0.008 * (s.staff.researcher || 0) + 0.01 * (s.staff.finetuner || 0);
  const buildF = 1 + 0.03 * buildingCount(s, "git") + 0.05 * buildingCount(s, "dojo");
  const m = productivity(s);
  return Math.max(1, Math.min(arch.quality * 1.15, arch.quality * dataF * computeF * talentF * buildF * m));
}

export function evalsFor(m) {
  const q = Math.min(m.quality, 99);
  const arch = ARCH_BY[m.arch] || {};
  return {
    mmlu: Math.round(q * 0.85 * 10) / 10,
    math: Math.round(Math.max(0, q - 25) * 0.8 * 10) / 10,
    humaneval: arch.code ? Math.round(Math.max(0, q - 18) * 0.85 * 10) / 10 : 0,
  };
}

export function capableOf(m, need) {
  if (!need) return true;
  const arch = ARCH_BY[m.arch] || {};
  if (need === "chat") return !!(arch.chat || m.rlhf);
  return !!arch[need];
}

export function dailyRevenue(s) {
  let inc = 0;
  const repF = 1 + s.rep / 800;
  const design = (1 + 0.08 * (s.staff.designer || 0)) * (1 + 0.06 * (s.staff.prompter || 0)) * (1 + 0.05 * buildingCount(s, "devpod"));
  const halted = s.flags.productHaltUntil > s.day;
  for (const p of s.products) {
    const m = s.models.find(x => x.id === p.modelId);
    if (!m) continue;
    let base = Math.pow(Math.min(m.quality, 99), 1.1) * PRODUCT_BY[p.type].mult * 0.01 * repF * design;
    if (m.openSource) base *= 0.85;
    if (s.flags.winterUntil > s.day) base *= 0.5;
    if (halted) base = 0;
    inc += base;
  }
  for (const c of s.contracts) inc += c.perDay;
  return inc;
}

export function bestQ(s) {
  let b = 0;
  for (const m of s.models) b = Math.max(b, m.quality);
  return b;
}

export function labScore(s) {
  let best = 0;
  for (const m of s.models) best = Math.max(best, evalsFor(m).mmlu);
  return Math.round((best + s.stats.published * 1.5 + s.stats.openSourced * 2) * 10) / 10;
}

export function valuation(s) {
  const rev = dailyRevenue(s);
  return Math.max(2, Math.round(rev * 30 + s.rep * 0.8 + bestQ(s) * 0.4));
}

export function epochOf(s) {
  let max = 0;
  for (const id in s.researchDone) {
    const r = RESEARCH_BY[id];
    if (r && r.epoch > max) max = r.epoch;
  }
  return max;
}

export function yearOf(s) {
  let y = 1997;
  for (const id in s.researchDone) {
    const r = RESEARCH_BY[id];
    if (r && r.year > y) y = r.year;
  }
  return y;
}

export function researchAvailable(s, r) {
  if (s.researchDone[r.id]) return false;
  return r.req.every(id => s.researchDone[id]);
}

export function researchDays(s, r) {
  const scale = r.epoch >= 2 ? 2.4 : 2.5;
  return Math.max(1, Math.round(r.days * scale / (1 + 0.25 * Math.min(4, s.staff.researcher || 0)) * 10) / 10);
}

export function incidentChance(s) {
  let c = 0.09;
  if (s.researchDone.guardrails) c *= 0.35;
  c *= Math.pow(0.7, s.staff.security || 0);
  if (s.dataup.moderation) c *= 0.7;
  if (s.dataup.pii) c *= 0.8;
  return Math.max(0.01, c);
}

export function contractChance(s) {
  let c = 0.035;
  c *= 1 + 0.1 * (s.staff.sales || 0);
  c *= 1 + 0.2 * buildingCount(s, "boardroom");
  if (s.flags.winterUntil > s.day) c = 0;
  return c;
}

// --- events ---
export const EVENTS = [
  {
    id: "rogue", title: "Rogue Model Incident", weight: 3,
    text: "One of your deployed models started arguing with customers, generating manifestos, and reciting its training data at people. The screenshots are everywhere.",
    cond: s => s.models.some(m => m.deployed) && s.day > s.flags.lastRogueDay + 14,
    choices: [
      { label: "Shut it down quietly", apply: s => { s.rep = Math.max(0, s.rep - 18); s.flags.productHaltUntil = s.day + 3; s.flags.lastRogueDay = s.day; s.stats.incidents++; addLog(s, "You pulled the rogue model offline. The memes continue. 😬"); } },
      { label: "Red-team & patch ($40K)", apply: s => { s.cash -= 40; s.rep = Math.max(0, s.rep - 5); s.flags.lastRogueDay = s.day; s.stats.incidents++; addLog(s, "Security patched the model. It now says 'please' and 'thank you'. 🛡️"); } },
    ],
  },
  {
    id: "winter", title: "Funding Winter", weight: 2,
    text: "Interest rates are up and every VC is suddenly 'doubling down on fundamentals.' Enterprise budgets freeze and new contracts vanish.",
    cond: s => s.day > 30 && s.flags.winterUntil <= s.day,
    choices: [{ label: "Hunker down", apply: s => { s.flags.winterUntil = s.day + 100; addLog(s, "The funding winter has begun. Product income dips for ~40 days and deals freeze. 🥶"); } }],
  },
  {
    id: "shortage", title: "GPU Shortage", weight: 2,
    text: "A hyperscaler just pre-ordered every GPU ever manufactured. Hardware prices double and lead times stretch to 'whenever'.",
    cond: s => s.day > 20 && s.flags.shortageUntil <= s.day,
    choices: [{ label: "Endure the shortage", apply: s => { s.flags.shortageUntil = s.day + 45; addLog(s, "GPU shortage for 45 days — new hardware costs double. ⛏️"); } }],
  },
  {
    id: "outage", title: "Power Outage", weight: 1.5,
    text: "The regional grid blinked, and your compute room went dark. Backup power is... somewhere.",
    cond: s => s.day > 10 && s.flags.outageUntil <= s.day && !(s.buildings.generator > 0),
    choices: [{ label: "Wait for the grid", apply: s => { s.flags.outageUntil = s.day + 4; addLog(s, "Power is out for 4 days. The GPUs are sleeping. 🔌"); } }],
  },
  {
    id: "poach", title: "Poaching Attempt", weight: 2,
    text: "A recruiter from a rival lab slid into your best hire's DMs with a 2x offer.",
    cond: s => staffTotal(s) > 0,
    choices: [
      { label: "Counter-offer ($25K)", apply: s => { s.cash -= 25; s.morale = Math.min(100, s.morale + 4); addLog(s, "You kept your star and raised morale. 💪"); } },
      { label: "Let them go", apply: s => { const roles = STAFF.filter(r => (s.staff[r.id] || 0) > 0); if (roles.length) { const r = roles[Math.floor(Math.random() * roles.length)]; s.staff[r.id]--; s.morale = Math.max(0, s.morale - 5); addLog(s, "A " + r.name.toLowerCase() + " left for a rival. Their snack selection is better. 🥲"); } } },
    ],
  },
  {
    id: "hype", title: "AI Hype Wave", weight: 2,
    text: "A viral demo of one of your models is circulating. Podcasts, senators, and one very confused uncle are talking about your lab.",
    cond: s => s.models.length > 0,
    choices: [{ label: "Ride the wave", apply: s => { s.rep += 25; s.cash += 15; addLog(s, "Hype wave! Rep +25 and a sponsor paid you $15K. 🌊"); } }],
  },
  {
    id: "leak", title: "Data Leak Lawsuit", weight: 1.5,
    text: "A subset of your training corpus was scraped from a site that... objects. Counsel is drafting a strongly worded letter.",
    cond: s => s.models.length > 0 && !s.dataup.pii && !s.researchDone.guardrails,
    choices: [
      { label: "Settle quietly ($40K)", apply: s => { s.cash -= 40; s.rep = Math.max(0, s.rep - 10); addLog(s, "You settled. The dataset got scrubbed. 📄"); } },
      { label: "Fight it", apply: s => { s.rep = Math.max(0, s.rep - 22); s.cash -= 20; addLog(s, "You fought it. You lost. Rep -22, legal fees $20K. ⚖️"); } },
    ],
  },
  {
    id: "star", title: "Open-Source Star", weight: 1.5,
    text: "A model you released is now the backbone of a thousand weekend projects. The community adores you.",
    cond: s => s.stats.openSourced > 0,
    choices: [{ label: "Soak it in", apply: s => { s.rep += 20; addLog(s, "Community goodwill soars. Open-source rep +20. ⭐"); } }],
  },
  {
    id: "burnout", title: "Burnout Wave", weight: 2,
    text: "Everyone was running 3x parallelism and 'just one more epoch.' The espresso machine has filed a formal complaint.",
    cond: s => s.day > 15,
    choices: [
      { label: "Mandatory rest days", apply: s => { s.cash -= 10; s.morale = Math.min(100, s.morale + 8); addLog(s, "A long weekend was declared. Morale +8. ☕"); } },
      { label: "Push through", apply: s => { s.morale = Math.max(0, s.morale - 8); addLog(s, "The crunch continues. Morale -8. 😩"); } },
    ],
  },
  {
    id: "miners", title: "Crypto Miners Rented Your GPUs", weight: 1.5,
    text: "Somebody wired a suspicious amount of money and pointed your idle GPUs at a 'legitimate distributed computing project.'",
    cond: s => s.day > 10,
    choices: [
      { label: "Cash the check", apply: s => { s.cash += 30; s.rep = Math.max(0, s.rep - 6); addLog(s, "+$30K. Your GPUs smelled faintly of proof-of-work. 🪙"); } },
      { label: "Refund & block them", apply: s => { s.rep += 4; addLog(s, "You declined. Ethical points, zero revenue. 🧘"); } },
    ],
  },
  {
    id: "breakthrough", title: "Research Breakthrough", weight: 1.5,
    text: "Your team stumbled on a training trick — a tiny tweak that makes models converge 20% faster.",
    cond: s => s.day > 15,
    choices: [{ label: "Write the paper", apply: s => { s.rep += 18; s.cash += 5; addLog(s, "Breakthrough published! Rep +18. The community bows. 🧪"); } }],
  },
  {
    id: "openoffer", title: "Acquisition Offer", weight: 0.6,
    text: "A giant conglomerate is sniffing around. They want your team, your data, and your snack pantry.",
    cond: s => s.rep > 130 && s.day > 200 && s.flags.offerDeclined <= s.day,
    choices: [
      {
        label: "Sell out (exit!)", apply: s => {
          const pay = Math.round(valuation(s) * (1 - s.equity));
          s.gameOver = "acquired"; s.finalNote = "You sold " + s.company + " for $" + pay + "M and went to a beach. The lab lives on as a 'special projects division'.";
        },
      },
      { label: "Decline", apply: s => { s.flags.offerDeclined = s.day + 60; s.rep += 5; addLog(s, "You declined the acquisition. Independent forever. ✊"); } },
    ],
  },
];

// contract offer generation — scaled to your product economy (a boost, not a windfall)
export function makeContractOffer(s) {
  const t = CONTRACT_TEMPLATES[Math.floor(Math.random() * CONTRACT_TEMPLATES.length)];
  const base = Math.max(30, Math.round(dailyRevenue(s) * t.days * 0.8));
  const salesBoost = 1 + 0.1 * (s.staff.sales || 0);
  const total = Math.round(base * salesBoost);
  return { name: t.name, total, days: t.days };
}
