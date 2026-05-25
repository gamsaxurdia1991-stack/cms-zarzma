const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const { marked } = require('marked');

const app = express();
const upload = multer({ dest: 'uploads/' });

// ==========================================
// 📂 JSON ბაზის ფუნქციები
// ==========================================
const DB_DIR = path.join(__dirname, 'database');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);

const readData = (fileName, defaultValue = []) => {
    const filePath = path.join(DB_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
        return defaultValue;
    }
    return JSON.parse(fs.readFileSync(filePath));
};

const writeData = (fileName, data) => {
    const filePath = path.join(DB_DIR, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

// 👑 სუპერ ლოგიკა: შენი პირადი მეილი, რომელიც არის ერთადერთი OWNER
const OWNER_EMAIL = 'grigoli@zarzma1.ge'; 

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'code-contest-platform', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use('/tasks', express.static(path.join(__dirname, 'tasks'))); // საჯარო წვდომა პირობებზე

app.use(session({
    secret: 'zarzma_secret_key_123',
    resave: false,
    saveUninitialized: true
}));

// ==========================================
// ⏱️ Middleware: ადმინების/Owner-ის აქტივობის სათვალთვალოდ
// ==========================================
app.use((req, res, next) => {
    if (req.session && req.session.userEmail && (req.session.role === 'admin' || req.session.role === 'owner')) {
        let admins = readData('admins.json', [
            { id: "1", username: "Admin", email: "admin@gmail.com", password: "admin", lastActive: null },
            { id: "2", username: "Grigoli", email: "grigoli@zarzma1.ge", password: "123qweasd", lastActive: null }
        ]);

        let updated = false;
        admins = admins.map(a => {
            if (a.email === req.session.userEmail) {
                a.lastActive = new Date().toISOString();
                updated = true;
            }
            return a;
        });

        if (updated) {
            writeData('admins.json', admins);
        }
    }
    next();
});

// ==========================================
// 👑 ადმინების მართვა (Owner & Admin)
// ==========================================

// 1. ადმინების სიის და რეგისტრაციის გვერდის ჩვენება
app.get('/register-admin', (req, res) => {
    if (!req.session || (req.session.role !== 'admin' && req.session.role !== 'owner')) {
        return res.status(403).send('წვდომა უარყოფილია: ამ გვერდზე შესვლა მხოლოდ ადმინისტრატორებს/მფლობელს შეუძლიათ!');
    }

    const admins = readData('admins.json', [
        { id: "1", username: "Admin", email: "admin@gmail.com", password: "admin", lastActive: null },
        { id: "2", username: "Grigoli", email: "grigoli@zarzma1.ge", password: "123qweasd", lastActive: null }
    ]);

    const now = new Date();
    const adminsWithStatus = admins.map(admin => {
        let isOnline = false;
        if (admin.lastActive) {
            const diffMinutes = Math.abs(now - new Date(admin.lastActive)) / 1000 / 60;
            if (diffMinutes < 5) isOnline = true; // აქტიურია თუ ბოლო 5 წუთში დაფიქსირდა მოქმედება
        }
        return {
            id: admin.id,
            username: admin.username,
            email: admin.email,
            isOnline: isOnline
        };
    });

    res.render('register-admin', { 
        admins: adminsWithStatus, 
        currentRole: req.session.role 
    }); 
});

// 2. ახალი ადმინის რეგისტრაცია (მხოლოდ OWNER-ს შეუძლია!)
app.post('/register-admin', (req, res) => {
    if (!req.session || req.session.role !== 'owner') {
        return res.status(403).send('მოქმედება უარყოფილია: ადმინის დამატება შეუძლია მხოლოდ Owner-ს!');
    }

    const { username, password, email } = req.body;
    const admins = readData('admins.json', []);

    if (admins.some(a => a.email === email.trim())) {
        return res.send('<script>alert("ეს ელ-ფოსტა უკვე გამოყენებულია!"); window.location="/register-admin";</script>');
    }

    if (username && password && email) {
        admins.push({
            id: Date.now().toString(),
            username: username.trim(),
            email: email.trim(),
            password: password.trim(),
            lastActive: null
        });
        writeData('admins.json', admins);
    }

    res.redirect('/register-admin');
});

// 3. ადმინის წაშლა (მხოლოდ OWNER-ს შეუძლია!)
app.post('/admin/delete-admin', (req, res) => {
    if (!req.session || req.session.role !== 'owner') {
        return res.status(403).send('მოქმედება უარყოფილია: ადმინის წაშლა შეუძლია მხოლოდ Owner-ს!');
    }

    const { adminId } = req.body;
    let admins = readData('admins.json', []);

    admins = admins.filter(a => a.id !== adminId);
    writeData('admins.json', admins);

    res.redirect('/register-admin');
});

// ==========================================
// ავტორიზაცია (Login)
// ==========================================
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/contests');
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    // 1. ადმინების/Owner-ის ფაილიდან წაკითხვა და შემოწმება
    const admins = readData('admins.json', [
        { id: "1", username: "Admin", email: "admin@gmail.com", password: "admin", lastActive: null },
        { id: "2", username: "Grigoli", email: "grigoli@zarzma1.ge", password: "123qweasd", lastActive: null }
    ]);

    const foundAdmin = admins.find(a => a.email === email.trim() && a.password === password);
    if (foundAdmin) {
        req.session.userId = `admin_${foundAdmin.email}`;
        req.session.userEmail = foundAdmin.email;
        
        // 🔒 თუ შენი კონკრეტული მეილია, ანიჭებს OWNER როლს, სხვა შემთხვევაში ჩვეულებრივ ADMIN-ს
        if (foundAdmin.email === OWNER_EMAIL) {
            req.session.role = 'owner';
        } else {
            req.session.role = 'admin';
        }
        return res.redirect('/contests');
    }
    
    // 2. Allowed List (Upsolving / Checker) შემოწმება
    const contests = readData('contests.json');
    const matchedContestForChecker = contests.find(c => c.allowedUser === email && c.allowedPassword === password);
    
    if (matchedContestForChecker) {
        req.session.userId = `checker_${email}_${Date.now()}`;
        req.session.role = 'checker';
        req.session.userEmail = email;
        return res.redirect('/contests');
    }
    
    // 3. სტანდარტული მოსწავლის შემოწმება
    const students = readData('students.json', [{ email: 'student@gmail.com', password: '123' }]);
    const foundStudent = students.find(s => s.email === email && s.password === password);
    if (foundStudent) {
        req.session.userId = `student_${foundStudent.email}`;
        req.session.role = 'student';
        req.session.userEmail = email;
        return res.redirect('/contests');
    }
    
    res.render('login', { error: 'არასწორი მეილი ან პაროლი!' });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/contests', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const contests = readData('contests.json');
    res.render('contests', { contests, role: req.session.role });
});

// ==========================================
// კონტესტების მართვა & კონფიგურაცია
// ==========================================
app.get('/admin/create-contest', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    res.render('create-contest');
});

app.post('/admin/create-contest', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const { title, tasks, duration } = req.body;
    
    if (title && title.trim() !== "") {
        const contests = readData('contests.json');
        const tasksArray = tasks ? tasks.split(',').map(t => t.trim()).filter(t => t !== "") : [];
        const newId = Date.now().toString();
        
        contests.push({
            id: newId,
            _id: newId,
            title: title.trim(),
            tasks: tasksArray,
            duration: parseInt(duration) || 180,
            createdAt: new Date().toISOString(),
            allowedUser: 'checker',       
            allowedPassword: 'checker'    
        });
        writeData('contests.json', contests);
    }
    res.redirect('/contests');
});

app.get('/admin/configure-contest/:id', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const contests = readData('contests.json');
    const contest = contests.find(c => c.id === req.params.id);
    if (!contest) return res.status(404).send('კონტესტი ვერ მოიძებნა');
    res.render('configure-contest', { contest });
});

app.post('/admin/configure-contest/:id', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const { duration, allowedUser, allowedPassword } = req.body;
    
    const contests = readData('contests.json');
    const contest = contests.find(c => c.id === req.params.id);
    
    if (contest) {
        contest.duration = parseInt(duration) || 180;
        contest.allowedUser = allowedUser ? allowedUser.trim() : 'checker';
        contest.allowedPassword = allowedPassword ? allowedPassword.trim() : 'checker';
        writeData('contests.json', contests);
    }
    res.redirect('/contests');
});

app.post('/admin/delete-contest', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const { contestId } = req.body;
    
    let contests = readData('contests.json');
    contests = contests.filter(c => c.id !== contestId && c._id !== contestId);
    writeData('contests.json', contests);
    
    let allSubmissions = readData('submissions.json');
    allSubmissions = allSubmissions.filter(s => s.contestId !== contestId);
    writeData('submissions.json', allSubmissions);
    
    res.redirect('/contests');
});

// ==========================================
// CMS გარემო - კონტესტის შიდა გვერდი
// ==========================================
app.get('/contest/:id', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    
    const contests = readData('contests.json');
    const contest = contests.find(c => c.id === req.params.id || c._id === req.params.id);
    if (!contest) return res.status(404).send('კონტესტი ვერ მოიძებნა');
    
    const currentTask = req.query.task || null;
    const viewType = req.query.view || 'statement';
    
    const startTime = new Date(contest.createdAt);
    const endTime = new Date(startTime.getTime() + contest.duration * 60000);
    const timeLeft = Math.max(0, endTime - new Date());

    const allSubmissions = readData('submissions.json');
    let submissions = [];
    
    if (currentTask) {
        if (viewType === 'submissions') {
            submissions = allSubmissions.filter(s => s.contestId === contest.id && s.email === req.session.userEmail && s.taskName === currentTask);
        } else if (viewType === 'all-submissions') {
            submissions = allSubmissions.filter(s => s.contestId === contest.id && s.email === req.session.userEmail);
        }
    } else if (viewType === 'all-submissions') {
        submissions = allSubmissions.filter(s => s.contestId === contest.id && s.email === req.session.userEmail);
    }

    let taskStatementHtml = null;
    let pdfUrl = null;

    if (currentTask) {
        const pdfPath = path.join(__dirname, 'tasks', currentTask, 'statement.pdf');
        const statementPath = path.join(__dirname, 'tasks', currentTask, 'statement.md');
        
        if (fs.existsSync(pdfPath)) {
            pdfUrl = `/tasks/${currentTask}/statement.pdf`;
        } else if (fs.existsSync(statementPath)) {
            const markdownContent = fs.readFileSync(statementPath, 'utf-8');
            taskStatementHtml = marked(markdownContent);
        } else {
            taskStatementHtml = `<p class="text-muted">⚠️ პირობის ფაილი ვერ მოიძებნა <code>tasks/${currentTask}/</code> საქაღალდეში.</p>`;
        }
    }
    
    res.render('contest-view', {
        contest, currentTask, viewType, submissions, timeLeft, role: req.session.role,
        taskStatementHtml, pdfUrl
    });
});

// ==========================================
// CMS JUDGE - კოდის მიღება
// ==========================================
app.post('/submit-code', upload.single('codeFile'), (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    
    const { contestId, taskName } = req.body;
    const contests = readData('contests.json');
    const contest = contests.find(c => c.id === contestId);
    
    const startTime = new Date(contest.createdAt);
    const endTime = new Date(startTime.getTime() + contest.duration * 60000);
    
    if (new Date() > endTime && req.session.role !== 'checker' && req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(400).send('კონტესტის დრო ამოიწურა! გაგზავნა შეუძლიათ მხოლოდ Allowed იუზერებს (Upsolving).');
    }

    const allSubmissions = readData('submissions.json');
    const taskSubmissionsCount = allSubmissions.filter(s => 
        s.contestId === contestId && s.email === req.session.userEmail && s.taskName === taskName
    ).length;

    if (taskSubmissionsCount >= 50) {
        return res.status(400).send(`ამოგეწურათ კოდის გაგზავნის ლიმიტი (მაქსიმუმ 50 მცდელობა).`);
    }

    const file = req.file;
    if (!file) return res.status(400).send('ფაილი არ არის ატვირთული');

    const userCodePath = file.path;
    const compiledExePath = path.join(__dirname, 'uploads', `${file.filename}.exe`);
    let totalPoints = 0;
    let status = 'Accepted';

    try {
        execSync(`g++ ${userCodePath} -o ${compiledExePath}`);
        const taskFolder = path.join(__dirname, 'tasks', taskName);
        const inputDir = path.join(taskFolder, 'input');
        const outputDir = path.join(taskFolder, 'output');

        if (fs.existsSync(inputDir) && fs.existsSync(outputDir)) {
            const inputFiles = fs.readdirSync(inputDir);
            let passedTests = 0;

            inputFiles.forEach(inFile => {
                const parts = inFile.split('_');
                if (parts.length > 1) {
                    const testId = parts[1];
                    try {
                        const userOutput = execSync(`${compiledExePath}`, {
                            input: fs.readFileSync(path.join(inputDir, inFile)),
                            timeout: 2000
                        }).toString().trim();
                        const correctOutput = fs.readFileSync(path.join(outputDir, `output_${testId}`)).toString().trim();
                        if (userOutput === correctOutput) passedTests++;
                    } catch { status = 'Runtime Error / TLE'; }
                }
            });
            if (inputFiles.length > 0) totalPoints = Math.round((passedTests / inputFiles.length) * 100);
        } else { totalPoints = 100; }
    } catch { status = 'Compilation Error'; }

    if (fs.existsSync(userCodePath)) fs.unlinkSync(userCodePath);
    if (fs.existsSync(compiledExePath)) fs.unlinkSync(compiledExePath);

    const now = new Date();
    const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);

    allSubmissions.push({
        id: Date.now().toString(),
        contestId,
        email: req.session.userEmail,
        taskName,
        points: totalPoints,
        status,
        time: formattedDate 
    });
    writeData('submissions.json', allSubmissions);

    res.redirect(`/contest/${contestId}?task=${taskName}&view=submissions`);
});

// ==========================================
// 📊 ადმინის სკორბორდი
// ==========================================
app.get('/admin/scoreboard', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    
    const contestId = req.query.contestId;
    const contests = readData('contests.json');
    let selectedContest = contests.find(c => c.id === contestId) || null;
    
    let processedScoreboard = [];

    if (selectedContest) {
        const allSubmissions = readData('submissions.json');
        const contestSubmissions = allSubmissions.filter(s => s.contestId === contestId);

        const userMap = {};

        contestSubmissions.forEach(sub => {
            const email = sub.email;
            const task = sub.taskName;
            const points = parseInt(sub.points) || 0;
            const subTime = new Date(sub.time);

            if (!userMap[email]) {
                userMap[email] = {
                    email: email,
                    tasks: {},
                    totalPoints: 0
                };
            }

            if (!userMap[email].tasks[task] || points > userMap[email].tasks[task].points) {
                userMap[email].tasks[task] = { points: points, time: subTime };
            } else if (points === userMap[email].tasks[task].points && subTime < userMap[email].tasks[task].time) {
                userMap[email].tasks[task].time = subTime;
            }
        });

        processedScoreboard = Object.values(userMap).map(user => {
            let total = 0;
            let latestTime = new Date(0);

            selectedContest.tasks.forEach(taskName => {
                if (user.tasks[taskName]) {
                    total += user.tasks[taskName].points;
                    if (user.tasks[taskName].points > 0 && user.tasks[taskName].time > latestTime) {
                        latestTime = user.tasks[taskName].time;
                    }
                }
            });

            return {
                email: user.email,
                totalPoints: total,
                lastSubTime: total > 0 ? latestTime : new Date(8640000000000000)
            };
        });

        processedScoreboard.sort((a, b) => {
            if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
            return a.lastSubTime - b.lastSubTime;
        });
    }
    
    res.render('admin-scoreboard', { contests, selectedContest, scoreboard: processedScoreboard });
});

// ==========================================
// სტუდენტების მართვა & წაშლა
// ==========================================
app.get('/admin/register-student', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const students = readData('students.json', [{ email: 'student@gmail.com', password: '123' }]);
    res.render('register-student', { students, success: null });
});

app.post('/admin/register-student', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const { email, password } = req.body;
    const students = readData('students.json', [{ email: 'student@gmail.com', password: '123' }]);
    if (students.some(s => s.email === email)) return res.render('register-student', { students, success: 'ეს მეილი გამოყენებულია!' });
    if (email && password) { students.push({ id: Date.now().toString(), email: email.trim(), password: password.trim() }); writeData('students.json', students); }
    res.render('register-student', { students, success: 'მოსწავლე დარეგისტრირდა!' });
});

app.post('/admin/unregister-student', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    let students = readData('students.json', [{ email: 'student@gmail.com', password: '123' }]);
    students = students.filter(s => s.id !== req.body.id && s._id !== req.body.id);
    writeData('students.json', students);
    res.redirect('/admin/register-student');
});

// ==========================================
// კომუნიკაცია (Questions)
// ==========================================
app.get('/communication', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const allQuestions = readData('questions.json');
    const questions = (req.session.role === 'admin' || req.session.role === 'owner') ? allQuestions : allQuestions.filter(q => q.user === req.session.userEmail);
    res.render('communication', { questions, role: req.session.role });
});

app.post('/ask-question', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const { subject, text } = req.body;
    if (text) {
        const allQuestions = readData('questions.json');
        allQuestions.push({ id: Date.now().toString(), _id: Date.now().toString(), user: req.session.userEmail, subject, text, reply: '', time: new Date().toLocaleTimeString() });
        writeData('questions.json', allQuestions);
    }
    res.redirect('/communication');
});

app.post('/admin/reply-question', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const allQuestions = readData('questions.json');
    const question = allQuestions.find(q => q.id === req.body.qId || q._id === req.body.qId);
    if (question) { question.reply = req.body.replyText; writeData('questions.json', allQuestions); }
    res.redirect('/communication');
});

// სერვერის გაშვება
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 სერვერი წარმატებით გადაეშვა სრულ რეჟიმში!`);
    console.log(`🔗 გახსენი ბრაუზერში: http://cms.zarzma1.ge:${PORT}`);
});