# 🚀 FLAMELENS-AI — Quick Evaluation Guide for Judges

Welcome to **FLAMELENS-AI** (NASA Space Apps Challenge: *"Flame in Freefall: AI-Powered Fire Safety Insights from Microgravity Combustion Data"*).

---

## ✨ Quickest Path: Live Demo (No Installation)

👉 **[https://flamelens-app.vercel.app](https://flamelens-app.vercel.app)** — opens instantly in any browser. No setup, no ZIP, no Python.

🎬 **Video Walkthrough (4 min):** [https://youtu.be/rhcC1fDF0_4](https://youtu.be/rhcC1fDF0_4) — covers all four scientific pillars.

---

This package contains the complete application, mathematical models, machine-learning pipeline, datasets, and precompiled interactive production build.

---

## ⚡ Option 1: Instant Launch (Zero Installation Required)

The repository includes a ready-to-run production build in `app/dist/`. You can serve and interact with it immediately using Python's built-in web server:

```bash
# From the project root:
python -m http.server 8000 --directory app/dist
```

Then open your browser to:
👉 **[http://localhost:8000](http://localhost:8000)**

*(Alternatively, if Node.js is installed, you can run `npx serve app/dist`)*

---

## 🛠️ Option 2: Run in Development Mode

If you wish to run Vite live development mode with hot module reloading:

```bash
cd app
npm install
npm run dev
```

Visit the local URL shown in your terminal (typically `http://localhost:5173`).

---

## 🧪 Option 3: Python Science & ML Pipeline / Tests

To run the scientific test suite (Bayesian EIG, quality gates, fuel-stratified GPR, evidence integrity):

```bash
# In the root directory:
pip install -r requirements.txt   # If needed: pytest, numpy, scipy, scikit-learn
pytest tests/
```

To re-run the Bayesian active learning optimizer or GPR model generator:
```bash
python scripts/build_gpr_artifacts.py
```

---

## 🧭 Four Scientific Pillars to Explore

1. **Interactive 3D Combustion Laboratory (`#lab3d`)**
   - ISS Combustion Integrated Rack (CIR) / MDCA chamber environment.
   - Continuous gravity slider from microgravity ($0g$), Lunar ($0.16g$), Martian ($0.38g$), to Earth ($1.0g$).
   - Classical $d^2$-law droplet burning physics, cool flame transitions, and instrument cameras (Color, HiBMS Shadowgraphy, LLUV Chemiluminescence).

2. **Evidence Explorer (`#data`)**
   - 1,872 multi-regime flight runs across 24 NASA PSI flight campaigns.
   - Multi-factor Scientific Quality Gate verification with direct DOIs.

3. **Design Optimizer (`#optimizer`)**
   - Fuel-Stratified Gaussian Process Regression (GPR) surrogate models.
   - Bayesian Expected Information Gain (EIG) active learning for next-experiment selection.
   - Real-time hardware feasibility boundaries (ISS CIR flight limit vs. Ground Drop Tower).

4. **Experiment Comparison Studio (`#compare`)**
   - Multi-run parameter matching across fuels, oxidizer concentrations, and inert gas diluents.
   - Real-time $d^2(t)$ regression curves and one-click data package export.

---

## 📄 Key Repository Documents
- `README.md` — Comprehensive architectural overview and scientific citations.
- `LICENSE` — MIT Open Source License.
- `data/clean/data_dictionary.md` — Complete schema of variables, units, and measurement tolerances.
- `data/clean/SCIENTIFIC_QUALITY_REPORT.md` — Quality verification summary across all 24 flight campaigns.
