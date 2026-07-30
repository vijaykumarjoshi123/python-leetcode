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

    // Section 11H — surface pipelineEnabled so the navbar can render
    // the conditional "Pipelines" link without a second /me round-trip.
    // pipelineEnabled defaults to false on the User model, so the field
    // is always defined.
    res.json({
      token,
      user: {
        id: user._id,
        username,
        email,
        accountType: user.accountType,
        pipelineEnabled: !!user.pipelineEnabled,
      },
    });
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

    // Section 11H — surface pipelineEnabled + accountType on login so
    // the navbar can gate its conditional links without an extra /me
    // round-trip on every page load.
    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email,
        accountType: user.accountType,
        pipelineEnabled: !!user.pipelineEnabled,
      },
    });
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

    // Section 11H — strip the password but keep pipelineEnabled so
    // the navbar's conditional link can be re-evaluated if the flag
    // gets flipped on the server between page loads.
    if (user) {
      const { password, ...safe } = user.toObject();
      res.json(safe);
    } else {
      res.status(404).json({ msg: 'User not found' });
    }
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
