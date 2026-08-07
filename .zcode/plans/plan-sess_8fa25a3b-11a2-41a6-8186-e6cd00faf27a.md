Rebrand the project to "ETLninja" (🥷 ninja/ETL theme), rebranding everything except the local directory name, before starting the 200-problem implementation.

Scope:
- Backend: package.json name/description, server.js + worker.js + seed scripts Mongo URI defaults (python-leetcode → etlninja), .env/.env.example/.env.prod.example, seed descriptions.
- Frontend: package.json, public/index.html (title/meta), Navbar wordmark (🐍 PythonCode → 🥷 ETLninja), Home hero/tagline/feature copy, Login/Register subtitles, Auth page headings.
- Infra: docker-compose.yml (MONGO_INITDB_DATABASE, MONGODB_URI, volume names), docker-compose.prod.yml, root package.json, setup.sh, nginx (no brand strings expected, verify).
- Docs: README.md, GETTING_STARTED.md, DEPLOYMENT.md, HETZNER.md, TESTING_REPORT.md headers/refs.
- NOT touched: the `skills/` vendored NVIDIA marketplace, the local directory name.

After rebrand: rebuild images, restart stack, verify UI shows "ETLninja" + 🥷, run vitest. Then proceed to the 200-problem plan.