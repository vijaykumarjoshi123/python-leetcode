# Deployment Guide

## 🚀 Quick Start Deployment

### Prerequisites
- GitHub account
- Vercel account (for frontend)
- Railway.app or Render account (for backend)
- MongoDB Atlas account (for database)

---

## 📦 Step 1: Set up MongoDB Atlas (Free Cloud Database)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Sign up for free account
3. Create a new cluster (M0 free tier)
4. Get your connection string:
   - Click "Connect"
   - Choose "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database password

---

## 🔌 Step 2: Deploy Backend (Railway or Render)

### Option A: Railway.app

1. Go to [Railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select this repository
5. Add environment variables:
   ```
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_secure_random_string
   NODE_ENV=production
   ```
6. Set root directory: `backend`
7. Railway will auto-detect Node.js and deploy!
8. Copy your backend URL (e.g., `https://python-leetcode-prod.up.railway.app`)

### Option B: Render.com

1. Go to [Render.com](https://render.com)
2. Sign up with GitHub
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Configure:
   - **Name**: python-leetcode-api
   - **Environment**: Node
   - **Build Command**: `cd backend && npm install`
   - **Start Command**: `cd backend && npm start`
   - **Root Directory**: `/backend`
6. Add environment variables (same as above)
7. Deploy!

---

## 🎨 Step 3: Deploy Frontend (Vercel)

1. Go to [Vercel](https://vercel.com)
2. Sign up with GitHub
3. Click "Add New" → "Project"
4. Import this repository
5. Configure:
   - **Framework Preset**: Create React App
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `build`
6. Add environment variable:
   ```
   REACT_APP_API_URL=https://your-backend-url.up.railway.app
   ```
7. Click "Deploy"
8. Vercel will give you a live URL!

---

## 🌐 Step 4: Update API URLs

Update your code with the production URLs:

**In frontend/.env.production:**
```
REACT_APP_API_URL=https://your-backend-url.up.railway.app
```

**In backend/.env.production:**
```
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_secure_random_string
NODE_ENV=production
```

---

## 📱 Step 5: Connect Custom Domain (Optional)

### For Vercel Frontend:
1. Go to your Vercel project settings
2. Navigate to "Domains"
3. Add your custom domain
4. Update DNS records with provider

### For Railway Backend:
1. In Railway project, go to "Settings"
2. Add custom domain
3. Update DNS records

---

## 🔐 Security Checklist

- [ ] Change JWT_SECRET to a strong random string
- [ ] Enable MongoDB IP whitelist in Atlas
- [ ] Set environment variables in production
- [ ] Use HTTPS only
- [ ] Enable CORS properly
- [ ] Rate limit API endpoints
- [ ] Add input validation
- [ ] Monitor logs regularly

---

## 📊 Monitoring & Logs

### Railway:
- View logs in Railway dashboard
- Set up alerts in settings

### Render:
- View logs in Render dashboard
- Email notifications for failures

### Vercel:
- Monitor edge functions
- Check analytics dashboard

---

## 🆘 Troubleshooting

### Backend not connecting to MongoDB
```bash
# Check your MONGODB_URI format
# Should be: mongodb+srv://username:password@cluster.mongodb.net/database
```

### Frontend getting CORS errors
- Add backend URL to allowed origins
- Check environment variables are set

### Deployment stuck
- Check build logs
- Verify all dependencies are in package.json
- Clear build cache and retry

---

## 🎯 Next Steps

1. **Add more features**:
   - Video tutorials
   - Mock interviews
   - Contest mode
   - Premium subscription

2. **Performance optimization**:
   - Add caching
   - Optimize database queries
   - CDN for static files

3. **Marketing**:
   - SEO optimization
   - Social media
   - Community building

---

## 📞 Support

For deployment issues, refer to:
- [Railway Documentation](https://docs.railway.app)
- [Render Documentation](https://render.com/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [MongoDB Atlas Documentation](https://docs.atlas.mongodb.com/)
