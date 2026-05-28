const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const { marked } = require('marked');

const app = express();
const upload = multer({ dest: 'uploads/' });

// 📄 კონფიგურაცია მულტი-ფაილების მისაღებად (მაქსიმუმ 100 ტესტი ერთ ამოცანაში)
const contestUploadConfig = upload.fields([
    { name: 'taskPdfs', maxCount: 10 },
    { name: 'taskInputs', maxCount: 100 },
    { name: 'taskOutputs', maxCount: 100 }
]);

// ==========================================
// 📂 JSON ბაზის ფუნქციები და საქაღალდეები
// ==========================================
const DB_DIR = path.join(__dirname, 'database');
const CODES_DIR = path.join(__dirname, 'uploads', 'codes');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);
if (!fs.existsSync(CODES_DIR)) fs.mkdirSync(CODES_DIR, { recursive: true });

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
const OWNER_EMAIL = 'Zarzma7@gmail.com';

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
            { id: "1", username: "Admin", email: "admin@gmail.com", password: "admin", role: "admin", lastActive: null },
            { id: "2", username: "Grigoli", email: "Zarzma7@gmail.com", password: "123qweasd", role: "owner", lastActive: null }
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
app.get('/register-admin', (req, res) => {
    if (!req.session || (req.session.role !== 'admin' && req.session.role !== 'owner')) {
        return res.status(403).send('წვდომა უარყოფილია: ამ გვერდზე შესვლა მხოლოდ ადმინისტრატორებს/მფლობელს შეუძლიათ!');
    }

    const admins = readData('admins.json', [
        { id: "1", username: "Admin", email: "admin@gmail.com", password: "admin", role: "admin", lastActive: null },
        { id: "2", username: "Grigoli", email: "Zarzma7@gmail.com", password: "123qweasd", role: "owner", lastActive: null }
    ]);

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
            role: admin.role || 'admin',
            isOnline: isOnline
        };
    });

    res.render('register-admin', { 
        admins: adminsWithStatus, 
        currentRole: req.session.role 
    }); 
});

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
            role: 'admin',
            lastActive: null
        });
        writeData('admins.json', admins);
    }

    res.redirect('/register-admin');
});

app.post('/admin/delete-admin', (req, res) => {
    if (!req.session || req.session.role !== 'owner') {
        return res.status(403).send('მოქმედება უარყოფილია: ადმინის წაშლა შეუძლია მხოლოდ Owner-ს!');
    }

    const { adminId } = req.body;
    let admins = readData('admins.json', []);

    const targetAdmin = admins.find(a => a.id === adminId);
    if (targetAdmin && (targetAdmin.email === OWNER_EMAIL || targetAdmin.email === 'admin@gmail.com')) {
        return res.send('<script>alert("უსაზიზღროების გამო ამ პროფილის წაშლა აკრძალულია!"); window.location="/register-admin";</script>');
    }

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
    const cleanEmail = email.trim();
    
    // 1. თუ მთავარი OWNER შედის პირდაპირი შემოწმებით
    if (cleanEmail === 'Zarzma7@gmail.com' && password === '123qweasd') {
        req.session.userId = `owner_zarzma7`;
        req.session.userEmail = cleanEmail;
        req.session.role = 'owner';
        req.session.username = "Grigoli"; // რადგან ეს მთავარი ექაუნთია, პირდაპირ Grigoli დავუწეროთ
        return res.redirect('/contests');
    }
    
    const admins = readData('admins.json', [
        { id: "1", username: "Admin", email: "admin@gmail.com", password: "admin", role: "admin", lastActive: null },
        { id: "2", username: "Grigoli", email: "Zarzma7@gmail.com", password: "123qweasd", role: "owner", lastActive: null }
    ]);

    // 2. თუ ადმინთა ბაზაში მოიძებნა
    const foundAdmin = admins.find(a => a.email === cleanEmail && a.password === password);
    if (foundAdmin) {
        req.session.userId = `admin_${foundAdmin.email}`;
        req.session.userEmail = foundAdmin.email;
        // სესიაში ვინახავთ ადმინების ბაზაში არსებულ იუზერნეიმს (მაგ: Admin ან Grigoli)
        req.session.username = foundAdmin.username || "ადმინისტრატორი"; 
        
        if (foundAdmin.email === OWNER_EMAIL || foundAdmin.role === 'owner') {
            req.session.role = 'owner';
        } else {
            req.session.role = 'admin';
        }
        return res.redirect('/contests');
    }
    
    const contests = readData('contests.json');
    const matchedContestForChecker = contests.find(c => c.allowedUser === cleanEmail && c.allowedPassword === password);
    
    // 3. თუ ჩეკერია
    if (matchedContestForChecker) {
        req.session.userId = `checker_${cleanEmail}_${Date.now()}`;
        req.session.role = 'checker';
        req.session.userEmail = cleanEmail;
        req.session.username = "Checker"; // ჩეკერებისთვის დეფოლტ სახელი
        return res.redirect('/contests');
    }
    
    const students = readData('students.json', [{ email: 'student@gmail.com', password: '123' }]);
    const foundStudent = students.find(s => s.email === cleanEmail && s.password === password);
    
    // 4. თუ სტუდენტების ბაზაში მოიძებნა
    if (foundStudent) {
        req.session.userId = `student_${foundStudent.email}`;
        req.session.role = 'student';
        req.session.userEmail = cleanEmail;
        // აქ ვიღებთ რეგისტრაციისას ჩაწერილ სახელსა და გვარს (username)
        // თუ ძველ სტუდენტებს არ უწერიათ, ალტერნატივად გამოიყენებს 'სტუდენტი'-ს ან მეილის საწყისს
        req.session.username = foundStudent.username || foundStudent.name || cleanEmail.split('@')[0];
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
    
    res.render('contests', { 
        contests, 
        role: req.session.role,
        username: req.session.username // პირდაპირ სესიიდან ვატანთ გამზადებულ სახელს
    });
});

// ==========================================
// კონტესტების მართვა & კონფიგურაცია
// ==========================================
app.get('/admin/create-contest', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    res.render('create-contest');
});

app.post('/admin/create-contest', contestUploadConfig, (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    
    const { title, duration, taskNames, taskTimeLimits, taskMemoryLimits } = req.body;
    
    if (title && title.trim() !== "") {
        const contests = readData('contests.json');
        const newContestId = Date.now().toString();
        const finalizedTasksArray = [];

        const pdfFiles = req.files['taskPdfs'] || [];
        const inputFiles = req.files['taskInputs'] || [];
        const outputFiles = req.files['taskOutputs'] || [];

        const timeLimits = Array.isArray(taskTimeLimits) ? taskTimeLimits : [taskTimeLimits];
        const memoryLimits = Array.isArray(taskMemoryLimits) ? taskMemoryLimits : [taskMemoryLimits];

        if (taskNames && Array.isArray(taskNames)) {
            taskNames.forEach((name, index) => {
                const cleanName = name.trim();
                if (cleanName === "") return;

                const taskFolder = path.join(__dirname, 'tasks', cleanName);
                const inputDir = path.join(taskFolder, 'input');
                const outputDir = path.join(taskFolder, 'output');

                if (!fs.existsSync(taskFolder)) fs.mkdirSync(taskFolder, { recursive: true });
                if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir);
                if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

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
                    const oldPath = file.path;
                    const newPath = path.join(inputDir, `input_${testNum}`);
                    if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);
                });

                outputFiles.forEach((file, fIdx) => {
                    const testNum = getFileIndex(file.originalname, fIdx + 1);
                    const oldPath = file.path;
                    const newPath = path.join(outputDir, `output_${testNum}`);
                    if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);
                });

                finalizedTasksArray.push({
                    name: cleanName,
                    timeLimit: parseFloat(timeLimits[index]) || 2.0,
                    memoryLimit: parseInt(memoryLimits[index]) || 256
                });
            });
        }
        
        contests.push({
            id: newContestId,
            _id: newContestId,
            title: title.trim(),
            tasksData: finalizedTasksArray, 
            tasks: finalizedTasksArray.map(t => t.name), 
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
    const contest = contests.find(c => String(c.id) === String(req.params.id));
    if (!contest) return res.status(404).send('კონტესტი ვერ მოიძებნა');
    res.render('configure-contest', { contest });
});

app.post('/admin/configure-contest/:id', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const { duration, allowedUser, allowedPassword } = req.body;
    
    const contests = readData('contests.json');
    const contest = contests.find(c => String(c.id) === String(req.params.id));
    
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
    
    // 1. ვპოულობთ კონტესტს წაშლამდე, რომ გავიგოთ რა ამოცანები (tasks) ჰქონდა მასში
    const contestToDelete = contests.find(c => String(c.id) === String(contestId) || String(c._id) === String(contestId));
    
    if (contestToDelete && contestToDelete.tasks && contestToDelete.tasks.length > 0) {
        const fs = require('fs');
        const path = require('path');
        
        // სათითაოდ გადავუაროთ კონტესტში არსებულ ყველა დავალების საქაღალდეს
        contestToDelete.tasks.forEach(taskName => {
            const taskFolderPath = path.join(__dirname, 'tasks', taskName);
            
            // თუ საქაღალდე არსებობს, ვშლით მას ძირიან-ფესვიანად (input, output, pdf)
            if (fs.existsSync(taskFolderPath)) {
                try {
                    fs.rmSync(taskFolderPath, { recursive: true, force: true });
                    console.log(`საქაღალდე [${taskName}] ავტომატურად წაიშალა.`);
                } catch (err) {
                    console.error(`შეცდომა [${taskName}] საქაღალდის წაშლისას:`, err);
                }
            }
        });
    }

    // 2. ვშლით კონტესტს ბაზიდან (შენი ორიგინალი ლოგიკა)
    contests = contests.filter(c => String(c.id) !== String(contestId) && String(c._id) !== String(contestId));
    writeData('contests.json', contests);
    
    // 3. ვშლით ამ კონტესტის სუბმიშენებს
    let allSubmissions = readData('submissions.json');
    allSubmissions = allSubmissions.filter(s => String(s.contestId) !== String(contestId));
    writeData('submissions.json', allSubmissions);

    // 4. ვშლით ამ კონტესტის კითხვებს
    let allQuestions = readData('questions.json');
    allQuestions = allQuestions.filter(q => String(q.contestId) !== String(contestId));
    writeData('questions.json', allQuestions);
    
    res.redirect('/contests');
});

// ==========================================
// CMS გარემო - კონტესტის შიდა გვერდი
// ==========================================
app.get('/contest/:id', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    
    const contests = readData('contests.json');
    const contest = contests.find(c => String(c.id) === String(req.params.id) || String(c._id) === String(req.params.id));
    if (!contest) return res.status(404).send('კონტესტი ვერ მოიძებნა');
    
    const currentTask = req.query.task || null;
    const viewType = req.query.view || 'overview';
    
    const startTime = new Date(contest.createdAt);
    const endTime = new Date(startTime.getTime() + contest.duration * 60000);
    const timeLeft = Math.max(0, endTime - new Date());

    const allSubmissions = readData('submissions.json');
    let submissions = [];
    
    if (currentTask) {
        if (viewType === 'submissions') {
            submissions = allSubmissions.filter(s => String(s.contestId) === String(contest.id) && s.email === req.session.userEmail && s.taskName === currentTask);
        } else if (viewType === 'all-submissions') {
            submissions = allSubmissions.filter(s => String(s.contestId) === String(contest.id) && s.email === req.session.userEmail);
        }
    } else if (viewType === 'all-submissions') {
        submissions = allSubmissions.filter(s => String(s.contestId) === String(contest.id) && s.email === req.session.userEmail);
    }

    let remainingSubmissions = 50;
    if (currentTask) {
        const currentTaskSubs = allSubmissions.filter(s => 
            String(s.contestId) === String(contest.id) && s.email === req.session.userEmail && s.taskName === currentTask
        ).length;
        remainingSubmissions = Math.max(0, 50 - currentTaskSubs);
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
        taskStatementHtml, pdfUrl, taskLimits, remainingSubmissions
    });
});

// ==========================================
// 📥 როუტები კოდის გადმოწერისთვის და დეტალებისთვის
// ==========================================
app.get('/download-code/:id', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    
    const submissions = readData('submissions.json');
    const sub = submissions.find(s => String(s.id) === String(req.params.id));
    
    if (!sub) return res.status(404).send('ჩანაწერი ვერ მოიძებნა');
    
    // უსაფრთხოება: მოსწავლე მხოლოდ საკუთარ ფაილს იწერს, ადმინი/owner ყველასას
    if (req.session.role === 'student' && sub.email !== req.session.userEmail) {
        return res.status(403).send('წვდომა უარყოფილია');
    }
    
    const savedCodePath = path.join(CODES_DIR, sub.savedFilename);
    if (!fs.existsSync(savedCodePath)) {
        return res.status(404).send('კოდის ფაილი სერვერზე ვერ მოიძებნა');
    }
    
    res.download(savedCodePath, `${sub.taskName}_submission.cpp`);
});

// 🚀 განახლებული როუტი /submission/:id - კოდის უსაფრთხო წაკითხვით და თავსებადობით
app.get('/submission/:id', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    
    const submissions = readData('submissions.json');
    const sub = submissions.find(s => String(s.id) === String(req.params.id));
    
    if (!sub) return res.status(404).send('ჩანაწერი ვერ მოიძებნა');
    
    if (req.session.role === 'student' && sub.email !== req.session.userEmail) {
        return res.status(403).send('წვდომა უარყოფილია');
    }
    
    // ვკითხულობთ კოდის ფაილს სერვერის მხრიდან
    let codeContent = "კოდის ფაილი ვერ მოიძებნა ან წაშლილია.";
    if (sub.savedFilename) {
        const codePath = path.join(CODES_DIR, sub.savedFilename);
        if (fs.existsSync(codePath)) {
            codeContent = fs.readFileSync(codePath, 'utf-8');
        }
    }
    
    // კოდის ტექსტს პირდაპირ ობიექტში ვსვამთ, რომ EJS-მა უპრობლემოდ დაინახოს
    sub.codeContent = codeContent;
    
    res.render('submission-details', { sub });
});

// ==========================================
// CMS JUDGE - კოდის მიღება და ტესტირება
// ==========================================
app.post('/submit-code', upload.single('codeFile'), (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    
    const { contestId, taskName } = req.body;
    const contests = readData('contests.json');
    const contest = contests.find(c => String(c.id) === String(contestId));
    
    const startTime = new Date(contest.createdAt);
    const endTime = new Date(startTime.getTime() + contest.duration * 60000);
    
    if (new Date() > endTime && req.session.role !== 'checker' && req.session.role !== 'admin' && req.session.role !== 'owner') {
        return res.status(400).send('კონტესტის დრო ამოიწურა! გაგზავნა შეუძლიათ მხოლოდ Allowed იუზერებს (Upsolving).');
    }

    const allSubmissions = readData('submissions.json');
    const taskSubmissionsCount = allSubmissions.filter(s => 
        String(s.contestId) === String(contestId) && s.email === req.session.userEmail && s.taskName === taskName
    ).length;

    if (taskSubmissionsCount >= 50) {
        return res.status(400).send(`ამოგეწურათ კოდის გაგზავნის ლიმიტი (მაქსიმუმ 50 მცდელობა).`);
    }

    const file = req.file;
    if (!file) return res.status(400).send('ფაილი არ არის ატვირთული');

    let taskTimeLimit = 2.0; 
    if (contest && contest.tasksData) {
        const foundTask = contest.tasksData.find(t => String(t.name).trim() === String(taskName).trim());
        if (foundTask) taskTimeLimit = parseFloat(foundTask.timeLimit) || 2.0;
    }
    
    const executionTimeout = Math.round(taskTimeLimit * 1000) + 2500; 

    const originalUploadedPath = file.path;
    const userCodePath = `${originalUploadedPath}.cpp`;
    
    try {
        fs.renameSync(originalUploadedPath, userCodePath);
    } catch (renameErr) {
        return res.status(500).send('ფაილის გადარქმევის შეცდომა სერვერზე.');
    }

    const compiledExePath = path.join(__dirname, 'uploads', `${file.filename}.exe`);
    let totalPoints = 0;
    let status = 'Compilation succeeded';
    let compiledSuccessfully = false;
    let maxExecutionTime = 0;
    let memoryUsed = "147 MiB"; // იმიტირებული დეფოლტ მეხსიერება (CMS-ის მსგავსად)

    const startTimeExecution = Date.now();
    try {
        execSync(`g++ -O3 -std=c++17 "${userCodePath}" -o "${compiledExePath}"`, { stdio: 'pipe' });
        compiledSuccessfully = true;
    } catch (err) { 
        status = 'Compilation failed'; 
        console.log("\n❌====== G++ COMPILATION ERROR ======");
        if (err.stderr) {
            console.log(err.stderr.toString());
        } else {
            console.log(err.message);
        }
        console.log("=====================================\n");
    }
    const compilationDuration = ((Date.now() - startTimeExecution) / 1000).toFixed(3);

    if (compiledSuccessfully) {
        const taskFolder = path.join(__dirname, 'tasks', taskName);
        const inputDir = path.join(taskFolder, 'input');
        const outputDir = path.join(taskFolder, 'output');

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
                
                const testId = match[0];
                const currentInputData = fs.readFileSync(path.join(inputDir, inFile));
                
                const singleTestStart = Date.now();
                try {
                    const userOutput = execSync(`"${compiledExePath}"`, {
                        input: currentInputData,
                        timeout: executionTimeout, 
                        maxBuffer: 1024 * 1024 * 10 
                    }).toString().trim();
                    
                    const testDuration = (Date.now() - singleTestStart) / 1000;
                    if (testDuration > maxExecutionTime) maxExecutionTime = testDuration;

                    const outPath = path.join(outputDir, `output_${testId}`);
                    if (fs.existsSync(outPath)) {
                        const correctOutput = fs.readFileSync(outPath).toString().trim();
                        if (userOutput === correctOutput) {
                            passedTests++;
                        } else {
                            status = `Evaluated (Wrong Answer)`;
                            break; 
                        }
                    }
                } catch (execErr) { 
                    if (execErr.code === 'ETIMEDOUT') {
                        status = `Evaluated (Time Limit Exceeded)`;
                    } else {
                        status = `Evaluated (Runtime Error)`;
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

    // 💾 ორიგინალი კოდის შენახვა გადმოწერისთვის, სანამ დროებითს წავშლით
    const savedFilename = `${Date.now()}_${file.filename}.cpp`;
    fs.copyFileSync(userCodePath, path.join(CODES_DIR, savedFilename));

    if (fs.existsSync(userCodePath)) fs.unlinkSync(userCodePath);
    if (fs.existsSync(compiledExePath)) fs.unlinkSync(compiledExePath);

    const now = new Date();
    const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);

    allSubmissions.push({
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
    writeData('submissions.json', allSubmissions);

    res.redirect(`/contest/${contestId}?task=${taskName}&view=submissions`);
});

// ==========================================
// 📊 ადმინის სკორბორდი (სრულყოფილი ლოგიკა)
// ==========================================
app.get('/admin/scoreboard', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    
    const contestId = req.query.contestId;
    const contests = readData('contests.json');
    let selectedContest = contests.find(c => String(c.id) === String(contestId)) || null;
    
    let usersData = [];

    if (selectedContest) {
        const allSubmissions = readData('submissions.json');
        const students = readData('students.json', []);
        
        const contestSubmissions = allSubmissions.filter(s => String(s.contestId) === String(contestId));
        const uniqueEmails = [...new Set(contestSubmissions.map(s => s.email))];

        uniqueEmails.forEach(email => {
            const matchStudent = students.find(s => String(s.email).trim() === String(email).trim());
            const studentName = matchStudent && matchStudent.name ? matchStudent.name : 'სტუდენტი';

            let userBestSubmissions = [];
            
            selectedContest.tasks.forEach(taskName => {
                const taskSubs = contestSubmissions.filter(s => String(s.email).trim() === String(email).trim() && String(s.taskName).trim() === String(taskName).trim());
                if (taskSubs.length > 0) {
                    const bestSub = taskSubs.reduce((max, s) => (parseInt(s.points) || 0) > (parseInt(max.points) || 0) ? s : max, taskSubs[0]);
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
// სტუდენტების მართვა & წაშლა
// ==========================================
app.get('/admin/register-student', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    
    const students = readData('students.json', [{ email: 'student@gmail.com', password: '123', username: 'ტესტ სტუდენტი' }]);
    
    // თუ url-ში გვექნება success პარამეტრი, გადმოვაყოლებთ EJS-ს
    const successMessage = req.query.success || null;
    res.render('register-student', { students, success: successMessage });
});

app.post('/admin/register-student', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    
    // EJS ფორმიდან ახლა უკვე მოდის 'username'
    const { email, password = "", username = "" } = req.body;
    const students = readData('students.json', [{ email: 'student@gmail.com', password: '123', username: 'ტესტ სტუდენტი' }]);
    
    // თუ ელ-ფოსტა უკვე არსებობს
    if (students.some(s => s.email === email)) {
        return res.render('register-student', { students, success: 'ეს მეილი გამოყენებულია!' });
    }
    
    if (email && password) { 
        students.push({ 
            id: Date.now().toString(), 
            username: username.trim() || 'სტუდენტი', // აქ ინახება სახელი და გვარი
            email: email.trim(), 
            password: password.trim() 
        }); 
        writeData('students.json', students); 
    }
    
    // გადამისამართება წარმატების შეტყობინებით
    res.redirect('/admin/register-student?success=' + encodeURIComponent('მოსწავლე წარმატებით დარეგისტრირდა!'));
});

app.post('/admin/unregister-student', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    
    const targetId = req.body.id || req.body.studentId; 
    let students = readData('students.json', [{ email: 'student@gmail.com', password: '123', username: 'ტესტ სტუდენტი' }]);
    
    students = students.filter(s => String(s.id) !== String(targetId) && String(s._id) !== String(targetId));
    writeData('students.json', students);
    
    res.redirect('/admin/register-student?success=' + encodeURIComponent('მოსწავლის რეგისტრაცია გაუქმებულია.'));
});
// ==========================================
// კომუნიკაცია (Questions სრულად შესაბამისი EJS-თან)
// ==========================================
app.get('/communication', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    
    const contestId = req.query.contestId || '';
    const userRole = req.session.role || 'user';
    const contests = readData('contests.json');
    
    let contestTitle = "";
    let tasks = [];
    
    if (contestId) {
        const currentContest = contests.find(c => String(c.id) === String(contestId));
        if (currentContest) {
            contestTitle = currentContest.title;
            tasks = currentContest.tasks || [];
        }
    }

    const allQuestions = readData('questions.json');
    let messages = [];
    
    if (userRole === 'admin' || userRole === 'owner') {
        messages = allQuestions.map(q => {
            const cMatch = contests.find(c => String(c.id) === String(q.contestId));
            return { ...q, contestTitle: cMatch ? cMatch.title : "Unknown Contest" };
        });
    } else {
        if (contestId) {
            messages = allQuestions.filter(q => String(q.contestId) === String(contestId) && q.userEmail === req.session.userEmail);
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

app.post('/communication/ask', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const { taskName, question, contestId } = req.body;
    
    if (question) {
        const allQuestions = readData('questions.json');
        allQuestions.push({ 
            id: Date.now().toString(), 
            contestId: String(contestId),
            userEmail: req.session.userEmail, 
            taskName: taskName || 'General', 
            question: question.trim(), 
            answer: '', 
            time: new Date().toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' })
        });
        writeData('questions.json', allQuestions);
    }
    res.redirect(`/communication?contestId=${contestId}`);
});

app.post('/communication/reply', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const { messageId, answer, redirectUrl } = req.body;
    
    const allQuestions = readData('questions.json');
    const question = allQuestions.find(q => String(q.id) === String(messageId));
    
    if (question && answer) { 
        question.answer = answer.trim(); 
        writeData('questions.json', allQuestions); 
    }
    res.redirect(redirectUrl || '/communication');
});
// სერვერის გაშვება
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 სერვერი წარმატებით გადაეშვა სრულ რეჟიმში!`);
    console.log(`🔗 გახსენი ბრაუზერში: http://localhost:${PORT}`);
});