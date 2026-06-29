# Getting Started - PythonCode Platform

## 🎯 Quick Start (5 minutes)

### Local Development

1. **Clone & Install**
```bash
cd ~/python-leetcode
npm run install-all
```

2. **Setup Environment**
```bash
cp backend/.env.example backend/.env
# Edit backend/.env and add your values
```

3. **Run MongoDB locally** (or use MongoDB Atlas)
```bash
# Install MongoDB if not already installed
brew install mongodb-community

# Start MongoDB
mongod
```

4. **Start Development Server**
```bash
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:5000

---

## 🚀 Production Deployment (15 minutes)

### Step 1: Create MongoDB Atlas (FREE)

1. Visit [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Sign up (free)
3. Create a cluster (M0 - Free)
4. Get connection string:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/python-leetcode
   ```

### Step 2: Deploy Backend (Railway)

1. Go to [Railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub Repo"
4. Select: `vijaykumarjoshi123/python-leetcode`
5. Set Root Directory: `backend`
6. Add Environment Variables:
   ```
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=generate_strong_random_string
   NODE_ENV=production
   PORT=5000
   ```
7. Railway will auto-deploy! ✨
8. Copy your Railway URL (appears in "Variables")

### Step 3: Deploy Frontend (Vercel)

1. Go to [Vercel.com](https://vercel.com)
2. Sign up with GitHub
3. Click "Add New" → "Project"
4. Import: `vijaykumarjoshi123/python-leetcode`
5. Configure:
   - Framework: Create React App
   - Root Directory: `frontend`
6. Add Environment Variable:
   ```
   REACT_APP_API_URL=https://your-railway-url
   ```
7. Click "Deploy"
8. Done! Your app is live! 🎉

---

## 🐳 Docker Deployment

### Run Everything in Docker

```bash
docker-compose up --build
```

This will:
- Start MongoDB
- Start Backend (port 5000)
- Start Frontend (port 3000)
- All connected and ready!

---

## 📋 Deployment Checklist

- [ ] MongoDB Atlas account created
- [ ] Database connection string obtained
- [ ] Backend deployed to Railway
- [ ] Frontend deployed to Vercel
- [ ] Environment variables set in both
- [ ] API URL connected in frontend
- [ ] Tested login/register flow
- [ ] Tested problem solving
- [ ] Tested leaderboard

---

## 🔑 Generate Strong JWT Secret

```bash
# Mac/Linux
openssl rand -base64 32

# Or use:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🧪 Test Your Deployment

1. **Sign Up**: Create a new account
2. **Browse Problems**: View the problem list
3. **Solve Problem**: Try solving a problem
4. **Check Leaderboard**: View global rankings
5. **Check Profile**: View your stats

---

## 📊 Monitor Your Apps

**Railway Logs**:
- Dashboard → Logs tab

**Vercel Logs**:
- Dashboard → Deployments → Logs

**MongoDB Atlas**:
- Clusters → Metrics

---

## 🆘 Troubleshooting

### "Cannot connect to MongoDB"
```
Check MONGODB_URI format:
✅ mongodb+srv://user:pass@cluster.mongodb.net/db
❌ mongodb://localhost:27017/db (only for local)
```

### "CORS Error"
```
Update backend to allow your Vercel domain
```

### "Frontend not connecting to API"
```
Check REACT_APP_API_URL is set in Vercel environment
```

---

## 🎓 Next Steps

1. **Add More Problems**: Run `node backend/seed.js` with more problems
2. **Add Features**:
   - Video tutorials
   - Live chat
   - Code collaboration
3. **Scale Up**:
   - CDN for static files
   - Database indexing
   - API caching

---

## 📞 Need Help?

- [Railway Docs](https://docs.railway.app)
- [Vercel Docs](https://vercel.com/docs)
- [MongoDB Docs](https://docs.mongodb.com)

---

## 🎉 Congratulations!

Your PythonCode platform is now live on the internet! Share the URL with friends and start building the next LeetCode! 🚀
