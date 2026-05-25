const mongoose = require('mongoose');

// 1. მომხმარებლის (მონაწილის/ადმინის) მოდელი
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    name: String
});

// 2. კონტესტების მოდელი
const contestSchema = new mongoose.Schema({
    title: { type: String, required: true },
    startTime: Date,
    endTime: Date
});

// 3. კითხვების (Communication) მოდელი
const questionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject: String, // მაგ: "power", "leprikon"
    text: String,
    answer: String, // ადმინის პასუხი
    createdAt: { type: Date, default: Date.now }
});

// 4. შედეგების/ქულების მოდელი (Scoreboard-ისთვის)
const submissionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    contest: { type: mongoose.Schema.Types.ObjectId, ref: 'Contest' },
    taskName: String,
    score: Number, // მაგ: 0-დან 100-მდე
    time: { type: Date, default: Date.now }
});

module.exports = {
    User: mongoose.model('User', userSchema),
    Contest: mongoose.model('Contest', contestSchema),
    Question: mongoose.model('Question', questionSchema),
    Submission: mongoose.model('Submission', submissionSchema)
};