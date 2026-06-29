#!/bin/bash

# PythonCode Platform - Deployment Setup Script

echo "🚀 PythonCode Platform - Deployment Setup"
echo "=========================================="
echo ""

# Check if node_modules exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing root dependencies..."
    npm install
fi

if [ ! -d "backend/node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    cd backend && npm install && cd ..
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

echo ""
echo "✅ Dependencies installed successfully!"
echo ""
echo "🌐 Deployment Options:"
echo ""
echo "1️⃣  Local Development:"
echo "   npm run dev"
echo ""
echo "2️⃣  Docker Deployment:"
echo "   docker-compose up --build"
echo ""
echo "3️⃣  Production Deployment:"
echo "   - Backend: Deploy to Railway.app or Render.com"
echo "   - Frontend: Deploy to Vercel.com"
echo "   - Database: Use MongoDB Atlas (free tier)"
echo ""
echo "📖 For detailed instructions, see: DEPLOYMENT.md"
echo ""
