# api/index.py  (Vercel Python Function entrypoint)
# Reuse your existing Flask app without changing routes.
# It expects your Flask routes to already start with `/api` (e.g., /api/health).
from app import app  # app.py must define `app = Flask(__name__)`

# Vercel looks for a top-level `app` in this file.
# We simply re-export the Flask app created in app.py
