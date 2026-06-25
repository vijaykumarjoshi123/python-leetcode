# Python Leetcode - Enterprise Platform

A comprehensive Python coding practice platform similar to LeetCode, built with React, Node.js, and MongoDB.

## 🚀 Features

- **1000+ Problems**: Organized by category and difficulty (Easy, Medium, Hard)
- **User Authentication**: Secure JWT-based login/registration
- **Code Editor**: Monaco Editor for writing and testing Python code
- **Real-time Execution**: Execute code and see results instantly
- **Leaderboards**: Global and difficulty-based rankings
- **Discussion Forums**: Community discussions for each problem
- **User Profiles**: Track progress, solved problems, and statistics
- **Solution Explanations**: Learn from community solutions
- **Progress Tracking**: Track which problems you've solved

## 📋 Tech Stack

- **Frontend**: React 18, React Router, Monaco Editor
- **Backend**: Node.js, Express.js
- **Database**: MongoDB
- **Real-time**: Socket.io
- **Authentication**: JWT, bcryptjs

## 🛠 Installation

### Prerequisites
- Node.js (v14+)
- MongoDB (local or cloud)
- Git

### Setup

1. **Clone the repository**
   ```bash
   cd ~/python-leetcode
   ```

2. **Install dependencies**
   ```bash
   npm run install-all
   ```

3. **Set up environment variables**

   Create `.env` in the `backend` folder:
   ```
   MONGODB_URI=mongodb://localhost:27017/python-leetcode
   JWT_SECRET=your_secret_key_here
   PORT=5000
   ```

4. **Start MongoDB**
   ```bash
   # Using local MongoDB
   mongod
   ```

5. **Run the application**
   ```bash
   npm run dev
   ```

   This will start both backend (port 5000) and frontend (port 3000) concurrently.

## 📁 Project Structure

```
python-leetcode/
├── backend/
│   ├── models/           # MongoDB schemas
│   ├── routes/           # API endpoints
│   ├── server.js         # Express app
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── pages/        # Page components
│   │   ├── services/     # API calls
│   │   └── App.js
│   └── package.json
├── shared/               # Shared utilities
└── package.json
```

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Problems
- `GET /api/problems` - Get all problems (with filters)
- `GET /api/problems/:id` - Get single problem
- `GET /api/problems/categories` - Get all categories

### Submissions
- `POST /api/submissions/submit` - Submit code
- `GET /api/submissions/user/:userId` - Get user submissions

### Leaderboard
- `GET /api/leaderboard` - Global leaderboard
- `GET /api/leaderboard/user/:userId` - User rank
- `GET /api/leaderboard/difficulty/:difficulty` - Difficulty-based ranking

### Forum
- `GET /api/forum/problem/:problemId` - Get discussions
- `POST /api/forum` - Create discussion
- `POST /api/forum/:discussionId/comment` - Add comment

## 🎯 Usage

1. **Register/Login** at http://localhost:3000/register or /login
2. **Browse Problems** - Filter by difficulty and category
3. **Solve Problems** - Use the Monaco Editor to write Python code
4. **Submit Solution** - Code is tested against hidden test cases
5. **View Leaderboard** - Check your rank and compete with others
6. **Discuss Solutions** - Ask questions and learn from community

## 📊 Database Schema

### User Model
- username, email, password (hashed)
- stats: totalSolved, totalAttempts, easyCount, mediumCount, hardCount
- solvedProblems, attemptedProblems (references)

### Problem Model
- title, slug, description, difficulty, category
- examples, constraints, hints
- testCases, solution, tags
- submissions, accepted, acceptanceRate

### Submission Model
- userId, problemId, code, language
- status (Accepted/Wrong Answer/TLE/Runtime Error)
- testCasesPassed, totalTestCases
- runtime, memory, error messages

### Discussion Model
- problemId, userId, title
- comments (nested structure)
- timestamps

## 🚀 Deployment

### Frontend (Vercel/Netlify)
```bash
npm run build
# Deploy the build folder
```

### Backend (Heroku/AWS)
```bash
git push heroku main
```

## 📈 Future Enhancements

- [ ] Code syntax highlighting improvements
- [ ] Collaborative coding sessions
- [ ] Problem tagging and advanced filtering
- [ ] Mobile app
- [ ] Multiple language support (Java, C++, JavaScript)
- [ ] Premium features (video tutorials, mock interviews)
- [ ] AI-powered hints and suggestions

## 🤝 Contributing

Contributions are welcome! Please fork the repository and submit pull requests.

## 📝 License

MIT License

## 📧 Support

For support, email: vijay@python-leetcode.com

---

**Happy Coding!** 🐍💻
