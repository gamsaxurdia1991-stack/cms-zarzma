const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const { marked } = require('marked');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo').default || require('connect-mongo');

// ==========================================
// 🔗 MongoDB კავშირი
// ⚠️ YOUR_PASSWORD-ის ნაცვლად ჩასვი შენი პაროლი
// ==========================================
const MONGO_URI = 'mongodb+srv://zarzma:zarzma777@cluster0.8xbmxry.mongodb.net/zarzma_judge?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Atlas-თან კავშირი დამყარდა!'))
    .catch(err => console.error('❌ MongoDB შეცდომა:', err));

// ==========================================
// 📋 MongoDB სქემები
// ==========================================
const StudentSchema = new mongoose.Schema({
    id: String,
    username: String,
    email: { type: String, unique: true },
    password: String
});

const AdminSchema = new mongoose.Schema({
    id: String,
    username: String,
    email: { type: String, unique: true },
    password: String,
    role: { type: String, default: 'admin' },
    lastActive: Date
});

const ContestSchema = new mongoose.Schema({
    id: String,
    title: String,
    tasks: [String],
    tasksData: [{ name: String, timeLimit: Number, memoryLimit: Number }],
    duration: Number,
    createdAt: String,
    allowedUser: String,
    allowedPassword: String
});

const SubmissionSchema = new mongoose.Schema({
    id: String,
    contestId: String,
    email: String,
    taskName: String,
    points: Number,
    status: String,
    compilationTime: String,
    executionTime: String,
    memoryUsed: String,
    savedFilename: String,
    time: String
});

const QuestionSchema = new mongoose.Schema({
    id: String,
    contestId: String,
    userEmail: String,
    taskName: String,
    question: String,
    answer: { type: String, default: '' },
    time: String
});

const Student    = mongoose.model('Student',    StudentSchema);
const Admin      = mongoose.model('Admin',      AdminSchema);
const Contest    = mongoose.model('Contest',    ContestSchema);
const Submission = mongoose.model('Submission', SubmissionSchema);
const Question   = mongoose.model('Question',   QuestionSchema);

// ==========================================
// 🌱 პირველი გაშვებისას საწყისი ადმინების შექმნა
// ==========================================
async function seedAdmins() {
    const count = await Admin.countDocuments();
    if (count === 0) {
        await Admin.insertMany([
            {
                id: "1",
                username: "Admin",
                email: "admin@gmail.com",
                password: "admin",
                role: "admin",
                lastActive: null
            },
            {
                id: "2",
                username: "Grigoli",
                email: "Zarzma7@gmail.com",
                password: "123qweasd",
                role: "owner",
                lastActive: null
            }
        ]);
        console.log('🌱 საწყისი ადმინები შეიქმნა');
    }
}

mongoose.connection.once('open', seedAdmins);

// ==========================================
// ⚙️ Express კონფიგურაცია
// ==========================================
const app = express();

const upload = multer({ dest: 'uploads/' });

const contestUploadConfig = upload.fields([
    { name: 'taskPdfs',    maxCount: 10  },
    { name: 'taskInputs',  maxCount: 100 },
    { name: 'taskOutputs', maxCount: 100 }
]);

const CODES_DIR = path.join(__dirname, 'uploads', 'codes');
if (!fs.existsSync(CODES_DIR)) fs.mkdirSync(CODES_DIR, { recursive: true });

const OWNER_EMAIL = 'Zarzma7@gmail.com';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'code-contest-platform', 'views'));

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/tasks',  express.static(path.join(__dirname, 'tasks')));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'zarzma_secret_key_123',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI })
}));

// ==========================================
// ⏱️ Middleware: ადმინის ბოლო აქტივობის ჩაწერა
// ==========================================
app.use(async (req, res, next) => {
    if (req.session && req.session.userEmail && (req.session.role === 'admin' || req.session.role === 'owner')) {
        await Admin.findOneAndUpdate(
            { email: req.session.userEmail },
            { lastActive: new Date() }
        );
    }
    next();
});

// ==========================================
// 👑 ადმინების მართვა
// ==========================================
app.get('/register-admin', async (req, res) => {
    if (!req.session || (req.session.role !== 'admin' && req.session.role !== 'owner')) {
        return res.status(403).send('წვდომა უარყოფილია: ამ გვერდზე შესვლა მხოლოდ ადმინისტრატორებს შეუძლიათ!');
    }

    const admins = await Admin.find().lean();
    const now = new Date();

    const adminsWithStatus = admins.map(admin => {
        let isOnline = false;
        if (admin.lastActive) {
            const diffMinutes = Math.abs(now - new Date(admin.lastActive)) / 1000 / 60;
            if (diffMinutes < 5) isOnline = true;
        }
        return {
            id: admin.id,
            username: admin.username,
            email: admin.email,
            role: admin.role,
            isOnline: isOnline
        };
    });

    res.render('register-admin', {
        admins: adminsWithStatus,
        currentRole: req.session.role
    });
});

app.post('/register-admin', async (req, res) => {
    if (!req.session || req.session.role !== 'owner') {
        return res.status(403).send('მოქმედება უარყოფილია: ადმინის დამატება შეუძლია მხოლოდ Owner-ს!');
    }

    const { username, password, email } = req.body;

    const exists = await Admin.findOne({ email: email.trim() });
    if (exists) {
        return res.send('<script>alert("ეს ელ-ფოსტა უკვე გამოყენებულია!"); window.location="/register-admin";</script>');
    }

    if (username && password && email) {
        await Admin.create({
            id: Date.now().toString(),
            username: username.trim(),
            email: email.trim(),
            password: password.trim(),
            role: 'admin',
            lastActive: null
        });
    }

    res.redirect('/register-admin');
});

app.post('/admin/delete-admin', async (req, res) => {
    if (!req.session || req.session.role !== 'owner') {
        return res.status(403).send('მოქმედება უარყოფილია: ადმინის წაშლა შეუძლია მხოლოდ Owner-ს!');
    }

    const { adminId } = req.body;
    const targetAdmin = await Admin.findOne({ id: adminId });

    if (targetAdmin && (targetAdmin.email === OWNER_EMAIL || targetAdmin.email === 'admin@gmail.com')) {
        return res.send('<script>alert("ამ პროფილის წაშლა აკრძალულია!"); window.location="/register-admin";</script>');
    }

    await Admin.deleteOne({ id: adminId });
    res.redirect('/register-admin');
});

// ==========================================
// 🔐 ავტორიზაცია (Login / Logout)
// ==========================================
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/contests');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const cleanEmail = email.trim();

    // 1. Owner-ის პირდაპირი შემოწმება
    if (cleanEmail === OWNER_EMAIL && password === '123qweasd') {
        req.session.userId    = 'owner_zarzma7';
        req.session.userEmail = cleanEmail;
        req.session.role      = 'owner';
        req.session.username  = 'Grigoli';
        return res.redirect('/contests');
    }

    // 2. ადმინების ბაზაში შემოწმება
    const foundAdmin = await Admin.findOne({ email: cleanEmail, password: password });
    if (foundAdmin) {
        req.session.userId    = `admin_${foundAdmin.email}`;
        req.session.userEmail = foundAdmin.email;
        req.session.username  = foundAdmin.username || 'ადმინისტრატორი';
        req.session.role      = (foundAdmin.email === OWNER_EMAIL || foundAdmin.role === 'owner') ? 'owner' : 'admin';
        return res.redirect('/contests');
    }

    // 3. Checker-ის შემოწმება (კონტესტის allowedUser/allowedPassword)
    const allContests = await Contest.find().lean();
    const checkerContest = allContests.find(c => c.allowedUser === cleanEmail && c.allowedPassword === password);
    if (checkerContest) {
        req.session.userId    = `checker_${cleanEmail}_${Date.now()}`;
        req.session.role      = 'checker';
        req.session.userEmail = cleanEmail;
        req.session.username  = 'Checker';
        return res.redirect('/contests');
    }

    // 4. სტუდენტების ბაზაში შემოწმება
    const foundStudent = await Student.findOne({ email: cleanEmail, password: password });
    if (foundStudent) {
        req.session.userId    = `student_${foundStudent.email}`;
        req.session.role      = 'student';
        req.session.userEmail = cleanEmail;
        req.session.username  = foundStudent.username || cleanEmail.split('@')[0];
        return res.redirect('/contests');
    }

    res.render('login', { error: 'არასწორი მეილი ან პაროლი!' });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ==========================================
// 🏠 კონტესტების სია (Dashboard)
// ==========================================
app.get('/contests', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');

    const contests = await Contest.find().lean();

    res.render('contests', {
        contests,
        role: req.session.role,
        username: req.session.username
    });
});

// ==========================================
// ➕ კონტესტის შექმნა
// ==========================================
app.get('/admin/create-contest', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(403).send('წვდომა უარყოფილია');
    }
    res.render('create-contest');
});

app.post('/admin/create-contest', contestUploadConfig, async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(403).send('წვდომა უარყოფილია');
    }

    const { title, duration, taskNames, taskTimeLimits, taskMemoryLimits } = req.body;

    if (!title || title.trim() === '') {
        return res.redirect('/contests');
    }

    const newContestId     = Date.now().toString();
    const finalizedTasks   = [];
    const pdfFiles         = req.files['taskPdfs']    || [];
    const inputFiles       = req.files['taskInputs']  || [];
    const outputFiles      = req.files['taskOutputs'] || [];
    const timeLimits       = Array.isArray(taskTimeLimits)   ? taskTimeLimits   : [taskTimeLimits];
    const memoryLimits     = Array.isArray(taskMemoryLimits) ? taskMemoryLimits : [taskMemoryLimits];

    if (taskNames && Array.isArray(taskNames)) {
        taskNames.forEach((name, index) => {
            const cleanName = name.trim();
            if (!cleanName) return;

            const taskFolder = path.join(__dirname, 'tasks', cleanName);
            const inputDir   = path.join(taskFolder, 'input');
            const outputDir  = path.join(taskFolder, 'output');

            if (!fs.existsSync(taskFolder)) fs.mkdirSync(taskFolder, { recursive: true });
            if (!fs.existsSync(inputDir))   fs.mkdirSync(inputDir);
            if (!fs.existsSync(outputDir))  fs.mkdirSync(outputDir);

            if (pdfFiles[index]) {
                const oldPath = pdfFiles[index].path;
                const newPath = path.join(taskFolder, 'statement.pdf');
                fs.renameSync(oldPath, newPath);
            }

            const getFileIndex = (originalName, fallbackIndex) => {
                const match = originalName.match(/\d+/);
                return match ? match[0] : fallbackIndex;
            };

            inputFiles.forEach((file, fIdx) => {
                const testNum = getFileIndex(file.originalname, fIdx + 1);
                const newPath = path.join(inputDir, `input_${testNum}`);
                if (fs.existsSync(file.path)) fs.renameSync(file.path, newPath);
            });

            outputFiles.forEach((file, fIdx) => {
                const testNum = getFileIndex(file.originalname, fIdx + 1);
                const newPath = path.join(outputDir, `output_${testNum}`);
                if (fs.existsSync(file.path)) fs.renameSync(file.path, newPath);
            });

            finalizedTasks.push({
                name: cleanName,
                timeLimit: parseFloat(timeLimits[index]) || 2.0,
                memoryLimit: parseInt(memoryLimits[index]) || 256
            });
        });
    }

    await Contest.create({
        id: newContestId,
        title: title.trim(),
        tasksData: finalizedTasks,
        tasks: finalizedTasks.map(t => t.name),
        duration: parseInt(duration) || 180,
        createdAt: new Date().toISOString(),
        allowedUser: 'checker',
        allowedPassword: 'checker'
    });

    res.redirect('/contests');
});

// ==========================================
// 🔧 კონტესტის კონფიგურაცია
// ==========================================
app.get('/admin/configure-contest/:id', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(403).send('წვდომა უარყოფილია');
    }
    const contest = await Contest.findOne({ id: req.params.id }).lean();
    if (!contest) return res.status(404).send('კონტესტი ვერ მოიძებნა');
    res.render('configure-contest', { contest });
});

app.post('/admin/configure-contest/:id', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(403).send('წვდომა უარყოფილია');
    }
    const { duration, allowedUser, allowedPassword } = req.body;

    await Contest.findOneAndUpdate(
        { id: req.params.id },
        {
            duration: parseInt(duration) || 180,
            allowedUser: allowedUser ? allowedUser.trim() : 'checker',
            allowedPassword: allowedPassword ? allowedPassword.trim() : 'checker'
        }
    );

    res.redirect('/contests');
});

// ==========================================
// 🗑️ კონტესტის წაშლა
// ==========================================
app.post('/admin/delete-contest', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(403).send('წვდომა უარყოფილია');
    }

    const { contestId } = req.body;

    const contest = await Contest.findOne({ id: contestId }).lean();
    if (contest && contest.tasks && contest.tasks.length > 0) {
        contest.tasks.forEach(taskName => {
            const taskFolderPath = path.join(__dirname, 'tasks', taskName);
            if (fs.existsSync(taskFolderPath)) {
                try {
                    fs.rmSync(taskFolderPath, { recursive: true, force: true });
                    console.log(`საქაღალდე [${taskName}] წაიშალა.`);
                } catch (err) {
                    console.error(`შეცდომა [${taskName}] წაშლისას:`, err);
                }
            }
        });
    }

    await Contest.deleteOne({ id: contestId });
    await Submission.deleteMany({ contestId });
    await Question.deleteMany({ contestId });

    res.redirect('/contests');
});

// ==========================================
// 🖥️ კონტესტის შიდა გვერდი (CMS გარემო)
// ==========================================
app.get('/contest/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');

    const contest = await Contest.findOne({ id: req.params.id }).lean();
    if (!contest) return res.status(404).send('კონტესტი ვერ მოიძებნა');

    const currentTask = req.query.task || null;
    const viewType    = req.query.view || 'overview';

    const startTime = new Date(contest.createdAt);
    const endTime   = new Date(startTime.getTime() + contest.duration * 60000);
    const timeLeft  = Math.max(0, endTime - new Date());

    let submissions = [];
    if (viewType === 'all-submissions') {
        submissions = await Submission.find({
            contestId: contest.id,
            email: req.session.userEmail
        }).lean();
    } else if (viewType === 'submissions' && currentTask) {
        submissions = await Submission.find({
            contestId: contest.id,
            email: req.session.userEmail,
            taskName: currentTask
        }).lean();
    }

    let remainingSubmissions = 50;
    if (currentTask) {
        const count = await Submission.countDocuments({
            contestId: contest.id,
            email: req.session.userEmail,
            taskName: currentTask
        });
        remainingSubmissions = Math.max(0, 50 - count);
    }

    let taskLimits = { timeLimit: 2.0, memoryLimit: 256 };
    if (contest.tasksData && currentTask) {
        const foundTask = contest.tasksData.find(t => String(t.name).trim() === String(currentTask).trim());
        if (foundTask) {
            taskLimits = {
                timeLimit: parseFloat(foundTask.timeLimit) || 2.0,
                memoryLimit: parseInt(foundTask.memoryLimit) || 256
            };
        }
    }

    let taskStatementHtml = null;
    let pdfUrl = null;

    if (currentTask) {
        const pdfPath      = path.join(__dirname, 'tasks', currentTask, 'statement.pdf');
        const statementPath = path.join(__dirname, 'tasks', currentTask, 'statement.md');

        if (fs.existsSync(pdfPath)) {
            pdfUrl = `/tasks/${currentTask}/statement.pdf`;
        } else if (fs.existsSync(statementPath)) {
            const markdownContent = fs.readFileSync(statementPath, 'utf-8');
            taskStatementHtml = marked(markdownContent);
        } else {
            taskStatementHtml = `<p>⚠️ პირობის ფაილი ვერ მოიძებნა <code>tasks/${currentTask}/</code> საქაღალდეში.</p>`;
        }
    }

    res.render('contest-view', {
        contest,
        currentTask,
        viewType,
        submissions,
        timeLeft,
        role: req.session.role,
        taskStatementHtml,
        pdfUrl,
        taskLimits,
        remainingSubmissions
    });
});

// ==========================================
// 📥 კოდის გადმოწერა
// ==========================================
app.get('/download-code/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');

    const sub = await Submission.findOne({ id: req.params.id }).lean();
    if (!sub) return res.status(404).send('ჩანაწერი ვერ მოიძებნა');

    if (req.session.role === 'student' && sub.email !== req.session.userEmail) {
        return res.status(403).send('წვდომა უარყოფილია');
    }

    const savedCodePath = path.join(CODES_DIR, sub.savedFilename);
    if (!fs.existsSync(savedCodePath)) {
        return res.status(404).send('კოდის ფაილი სერვერზე ვერ მოიძებნა');
    }

    res.download(savedCodePath, `${sub.taskName}_submission.cpp`);
});

// ==========================================
// 📄 გაგზავნის დეტალები
// ==========================================
app.get('/submission/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');

    const sub = await Submission.findOne({ id: req.params.id }).lean();
    if (!sub) return res.status(404).send('ჩანაწერი ვერ მოიძებნა');

    if (req.session.role === 'student' && sub.email !== req.session.userEmail) {
        return res.status(403).send('წვდომა უარყოფილია');
    }

    let codeContent = 'კოდის ფაილი ვერ მოიძებნა ან წაშლილია.';
    if (sub.savedFilename) {
        const codePath = path.join(CODES_DIR, sub.savedFilename);
        if (fs.existsSync(codePath)) {
            codeContent = fs.readFileSync(codePath, 'utf-8');
        }
    }

    sub.codeContent = codeContent;
    res.render('submission-details', { sub });
});

// ==========================================
// ⚡ კოდის გაგზავნა და ტესტირება
// ==========================================
app.post('/submit-code', upload.single('codeFile'), async (req, res) => {
    if (!req.session.userId) return res.redirect('/');

    const { contestId, taskName } = req.body;
    const contest = await Contest.findOne({ id: contestId }).lean();
    if (!contest) return res.status(404).send('კონტესტი ვერ მოიძებნა');

    const startTime = new Date(contest.createdAt);
    const endTime   = new Date(startTime.getTime() + contest.duration * 60000);

    if (new Date() > endTime && req.session.role !== 'checker' && req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(400).send('კონტესტის დრო ამოიწურა! გაგზავნა შეუძლიათ მხოლოდ Allowed იუზერებს.');
    }

    const taskSubsCount = await Submission.countDocuments({
        contestId,
        email: req.session.userEmail,
        taskName
    });

    if (taskSubsCount >= 50) {
        return res.status(400).send('ამოგეწურათ კოდის გაგზავნის ლიმიტი (მაქსიმუმ 50 მცდელობა).');
    }

    const file = req.file;
    if (!file) return res.status(400).send('ფაილი არ არის ატვირთული');

    let taskTimeLimit = 2.0;
    if (contest.tasksData) {
        const foundTask = contest.tasksData.find(t => String(t.name).trim() === String(taskName).trim());
        if (foundTask) taskTimeLimit = parseFloat(foundTask.timeLimit) || 2.0;
    }

    const executionTimeout  = Math.round(taskTimeLimit * 1000) + 2500;
    const userCodePath      = `${file.path}.cpp`;
    const compiledExePath   = path.join(__dirname, 'uploads', `${file.filename}.exe`);

    try {
        fs.renameSync(file.path, userCodePath);
    } catch (renameErr) {
        return res.status(500).send('ფაილის გადარქმევის შეცდომა სერვერზე.');
    }

    let totalPoints        = 0;
    let status             = 'Compilation succeeded';
    let compiledSuccessfully = false;
    let maxExecutionTime   = 0;
    const memoryUsed       = '147 MiB';

    const compileStart = Date.now();
    try {
        execSync(`g++ -O3 -std=c++17 "${userCodePath}" -o "${compiledExePath}"`, { stdio: 'pipe' });
        compiledSuccessfully = true;
    } catch (err) {
        status = 'Compilation failed';
        console.log('❌ Compilation Error:', err.stderr ? err.stderr.toString() : err.message);
    }
    const compilationDuration = ((Date.now() - compileStart) / 1000).toFixed(3);

    if (compiledSuccessfully) {
        const taskFolder = path.join(__dirname, 'tasks', taskName);
        const inputDir   = path.join(taskFolder, 'input');
        const outputDir  = path.join(taskFolder, 'output');

        if (fs.existsSync(inputDir) && fs.existsSync(outputDir)) {
            const inputFiles = fs.readdirSync(inputDir).sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)?.[0] || 0);
                const numB = parseInt(b.match(/\d+/)?.[0] || 0);
                return numA - numB;
            });

            let passedTests = 0;

            for (const inFile of inputFiles) {
                const match = inFile.match(/\d+/);
                if (!match) continue;

                const testId        = match[0];
                const inputData     = fs.readFileSync(path.join(inputDir, inFile));
                const singleStart   = Date.now();

                try {
                    const userOutput = execSync(`"${compiledExePath}"`, {
                        input: inputData,
                        timeout: executionTimeout,
                        maxBuffer: 1024 * 1024 * 10
                    }).toString().trim();

                    const testDuration = (Date.now() - singleStart) / 1000;
                    if (testDuration > maxExecutionTime) maxExecutionTime = testDuration;

                    const outPath = path.join(outputDir, `output_${testId}`);
                    if (fs.existsSync(outPath)) {
                        const correctOutput = fs.readFileSync(outPath).toString().trim();
                        if (userOutput === correctOutput) {
                            passedTests++;
                        } else {
                            status = 'Evaluated (Wrong Answer)';
                            break;
                        }
                    }
                } catch (execErr) {
                    if (execErr.code === 'ETIMEDOUT') {
                        status = 'Evaluated (Time Limit Exceeded)';
                    } else {
                        status = 'Evaluated (Runtime Error)';
                    }
                    break;
                }
            }

            if (inputFiles.length > 0) {
                totalPoints = Math.round((passedTests / inputFiles.length) * 100);
            }

            if (status === 'Compilation succeeded' && totalPoints === 100) {
                status = 'Evaluated';
            }
        } else {
            totalPoints = 100;
            status = 'Evaluated';
        }
    }

    const savedFilename = `${Date.now()}_${file.filename}.cpp`;
    fs.copyFileSync(userCodePath, path.join(CODES_DIR, savedFilename));
    if (fs.existsSync(userCodePath))    fs.unlinkSync(userCodePath);
    if (fs.existsSync(compiledExePath)) fs.unlinkSync(compiledExePath);

    const formattedDate = new Date().toISOString().replace('T', ' ').substring(0, 19);

    await Submission.create({
        id: Date.now().toString(),
        contestId: String(contestId),
        email: req.session.userEmail,
        taskName,
        points: totalPoints,
        status,
        compilationTime: `${compilationDuration} sec`,
        executionTime: `${maxExecutionTime.toFixed(3)} sec`,
        memoryUsed,
        savedFilename,
        time: formattedDate
    });

    res.redirect(`/contest/${contestId}?task=${taskName}&view=submissions`);
});

// ==========================================
// 📊 ადმინის სკორბორდი
// ==========================================
app.get('/admin/scoreboard', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(403).send('წვდომა უარყოფილია');
    }

    const contests   = await Contest.find().lean();
    const contestId  = req.query.contestId;
    const selectedContest = contests.find(c => String(c.id) === String(contestId)) || null;

    let usersData = [];

    if (selectedContest) {
        const allSubmissions = await Submission.find({ contestId }).lean();
        const students       = await Student.find().lean();
        const uniqueEmails   = [...new Set(allSubmissions.map(s => s.email))];

        uniqueEmails.forEach(email => {
            const matchStudent  = students.find(s => String(s.email).trim() === String(email).trim());
            const studentName   = matchStudent && matchStudent.username ? matchStudent.username : 'სტუდენტი';

            const userBestSubmissions = [];

            selectedContest.tasks.forEach(taskName => {
                const taskSubs = allSubmissions.filter(
                    s => String(s.email).trim() === String(email).trim() &&
                         String(s.taskName).trim() === String(taskName).trim()
                );
                if (taskSubs.length > 0) {
                    const bestSub = taskSubs.reduce((max, s) =>
                        (parseInt(s.points) || 0) > (parseInt(max.points) || 0) ? s : max,
                        taskSubs[0]
                    );
                    userBestSubmissions.push({
                        taskName: taskName.trim(),
                        points: parseInt(bestSub.points) || 0,
                        time: bestSub.time
                    });
                }
            });

            usersData.push({
                name: studentName,
                email: email,
                submissions: userBestSubmissions
            });
        });
    }

    res.render('admin-scoreboard', {
        contests,
        selectedContest,
        usersData
    });
});

// ==========================================
// 👥 სტუდენტების მართვა
// ==========================================
app.get('/admin/register-student', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(403).send('წვდომა უარყოფილია');
    }
    const students = await Student.find().lean();
    const successMessage = req.query.success || null;
    res.render('register-student', { students, success: successMessage });
});

app.post('/admin/register-student', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(403).send('წვდომა უარყოფილია');
    }

    const { email, password = '', username = '' } = req.body;
    const exists = await Student.findOne({ email: email.trim() });

    if (exists) {
        const students = await Student.find().lean();
        return res.render('register-student', { students, success: 'ეს მეილი გამოყენებულია!' });
    }

    if (email && password) {
        await Student.create({
            id: Date.now().toString(),
            username: username.trim() || 'სტუდენტი',
            email: email.trim(),
            password: password.trim()
        });
    }

    res.redirect('/admin/register-student?success=' + encodeURIComponent('მოსწავლე წარმატებით დარეგისტრირდა!'));
});

app.post('/admin/unregister-student', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(403).send('წვდომა უარყოფილია');
    }
    const targetId = req.body.id || req.body.studentId;
    await Student.deleteOne({ id: targetId });
    res.redirect('/admin/register-student?success=' + encodeURIComponent('მოსწავლის რეგისტრაცია გაუქმებულია.'));
});

// ==========================================
// 💬 კომუნიკაცია
// ==========================================
app.get('/communication', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');

    const contestId  = req.query.contestId || '';
    const userRole   = req.session.role || 'user';
    const allContests = await Contest.find().lean();

    let contestTitle = '';
    let tasks        = [];

    if (contestId) {
        const currentContest = allContests.find(c => String(c.id) === String(contestId));
        if (currentContest) {
            contestTitle = currentContest.title;
            tasks        = currentContest.tasks || [];
        }
    }

    let messages = [];

    if (userRole === 'admin' || userRole === 'owner') {
        const allQuestions = await Question.find().lean();
        messages = allQuestions.map(q => {
            const cMatch = allContests.find(c => String(c.id) === String(q.contestId));
            return { ...q, contestTitle: cMatch ? cMatch.title : 'Unknown Contest' };
        });
    } else {
        if (contestId) {
            messages = await Question.find({
                contestId: contestId,
                userEmail: req.session.userEmail
            }).lean();
        }
    }

    res.render('communication', {
        messages,
        role: userRole,
        contestId,
        contestTitle,
        tasks
    });
});

app.post('/communication/ask', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');

    const { taskName, question, contestId } = req.body;

    if (question) {
        await Question.create({
            id: Date.now().toString(),
            contestId: String(contestId),
            userEmail: req.session.userEmail,
            taskName: taskName || 'General',
            question: question.trim(),
            answer: '',
            time: new Date().toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' })
        });
    }

    res.redirect(`/communication?contestId=${contestId}`);
});

app.post('/communication/reply', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(403).send('წვდომა უარყოფილია');
    }

    const { messageId, answer, redirectUrl } = req.body;

    if (answer) {
        await Question.findOneAndUpdate(
            { id: messageId },
            { answer: answer.trim() }
        );
    }

    res.redirect(redirectUrl || '/communication');
});

// ==========================================
// 🚀 სერვერის გაშვება
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 სერვერი წარმატებით გაეშვა!`);
    console.log(`🔗 გახსენი ბრაუზერში: http://localhost:${PORT}`);
});