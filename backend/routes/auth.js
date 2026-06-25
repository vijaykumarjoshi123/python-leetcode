const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Check if user exists
    let user = await User.findOne({ $or: [{ email }, { username }] });
    if (user) return res.status(400).json({ msg: 'User already exists' });
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user
    user = new User({
      username,
      email,
      password: hashedPassword
    });
    
    await user.save();
    
    // Generate JWT
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', {
      expiresIn: '7d'
    });
    
    res.json({ token, user: { id: user._id, username, email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: 'User not found' });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', {
      expiresIn: '7d'
    });
    
    res.json({ token, user: { id: user._id, username: user.username, email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ msg: 'No token' });
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await User.findById(decoded.userId);
    
    res.json(user);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
