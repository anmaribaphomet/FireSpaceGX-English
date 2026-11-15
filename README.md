# FireSpace GX

Project for the NASA Space Apps Challenge 2026. Student project, not an official NASA product.

**FireSpace GX** is a research and analysis platform for fire safety in space. It brings together NASA's microgravity combustion experiments (ACME, FLEX, SAFFIRE, BASS and more) so you can explore them, compare materials, identify combustion patterns and use AI to anticipate possible fire scenarios.

- **Home:** introduction, how-to tutorial and a sample dashboard (PSI-68) where every chart explains how to read it.
- **ApiGx (AI assistant):** answers questions using only official NASA sources, with linked citations, and builds a live dashboard of the conversation.
- **3GX (3D simulation):** a flame you can change with sliders (gravity, oxygen, size, PSI-68 compounds, mission environment), with physically based color and an AI interpretation of the danger based on NASA research.

## How to run it after cloning

**Requirements:** Python 3.10 or newer and a free [OpenRouter](https://openrouter.ai) key (*Settings → Keys*).

**1. Create the virtual environment and install the dependencies**

Windows (PowerShell):
```powershell
python -m venv .venv
.venv\Scripts\Activate
pip install -r requirements.txt
```

Mac / Linux:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**2. Create the `.env` file**

Copy `.env.example` as `.env` (in the same folder as `app.py`) and put your own OpenRouter key in `OPENROUTER_API_KEY`. Never upload the `.env` file to GitHub.

**3. Build the source library**
```bash
python scripts/ingestar_fuentes.py
```

**4. Start the application**
```bash
python app.py
```

Open **http://localhost:5000** in your browser. On Windows you can also double-click `start_app.bat`.
