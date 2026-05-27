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
            { id: "1", username: "Admin", email: "admin@gmail.com", password: "admin", lastActive: null },
            { id: "2", username: "Grigoli", email: "Zarzma7@gmail.com", password: "123qweasd", lastActive: null }
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
        { id: "1", username: "Admin", email: "admin@gmail.com", password: "admin", lastActive: null },
        { id: "2", username: "Grigoli", email: "Zarzma7@gmail.com", password: "123qweasd", lastActive: null }
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
        return res.send('<script>alert("უსაფრთხოების გამო ამ პროფილის წაშლა აკრძალულია!"); window.location="/register-admin";</script>');
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
    
    if (cleanEmail === 'Zarzma7@gmail.com' && password === '123qweasd') {
        req.session.userId = `owner_zarzma7`;
        req.session.userEmail = cleanEmail;
        req.session.role = 'owner';
        return res.redirect('/contests');
    }
    
    const admins = readData('admins.json', [
        { id: "1", username: "Admin", email: "admin@gmail.com", password: "admin", lastActive: null },
        { id: "2", username: "Grigoli", email: "Zarzma7@gmail.com", password: "123qweasd", lastActive: null }
    ]);

    const foundAdmin = admins.find(a => a.email === cleanEmail && a.password === password);
    if (foundAdmin) {
        req.session.userId = `admin_${foundAdmin.email}`;
        req.session.userEmail = foundAdmin.email;
        
        if (foundAdmin.email === OWNER_EMAIL) {
            req.session.role = 'owner';
        } else {
            req.session.role = 'admin';
        }
        return res.redirect('/contests');
    }
    
    const contests = readData('contests.json');
    const matchedContestForChecker = contests.find(c => c.allowedUser === cleanEmail && c.allowedPassword === password);
    
    if (matchedContestForChecker) {
        req.session.userId = `checker_${cleanEmail}_${Date.now()}`;
        req.session.role = 'checker';
        req.session.userEmail = cleanEmail;
        return res.redirect('/contests');
    }
    
    const students = readData('students.json', [{ email: 'student@gmail.com', password: '123' }]);
    const foundStudent = students.find(s => s.email === cleanEmail && s.password === password);
    if (foundStudent) {
        req.session.userId = `student_${foundStudent.email}`;
        req.session.role = 'student';
        req.session.userEmail = cleanEmail;
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
    contests = contests.filter(c => String(c.id) !== String(contestId) && String(c._id) !== String(contestId));
    writeData('contests.json', contests);
    
    let allSubmissions = readData('submissions.json');
    allSubmissions = allSubmissions.filter(s => String(s.contestId) !== String(contestId));
    writeData('submissions.json', allSubmissions);

    // 🛠️ ბაგის ფიქსი: კონტესტის წაშლისას იშლება მასზე მიბმული ყველა კითხვა-პასუხიც!
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
    const viewType = req.query.view || 'overview'; // დეფოლტად Overview, თუ არაფერია არჩეული
    
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
    let status = 'Accepted';
    let compiledSuccessfully = false;

    try {
        execSync(`g++ -O3 -std=c++17 "${userCodePath}" -o "${compiledExePath}"`, { stdio: 'pipe' });
        compiledSuccessfully = true;
    } catch (err) { 
        status = 'Compilation Error'; 
        console.log("\n❌====== G++ COMPILATION ERROR ======");
        if (err.stderr) {
            console.log(err.stderr.toString());
        } else {
            console.log(err.message);
        }
        console.log("=====================================\n");
    }

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
                
                try {
                    const userOutput = execSync(`"${compiledExePath}"`, {
                        input: currentInputData,
                        timeout: executionTimeout, 
                        maxBuffer: 1024 * 1024 * 10 
                    }).toString().trim();
                    
                    const outPath = path.join(outputDir, `output_${testId}`);
                    if (fs.existsSync(outPath)) {
                        const correctOutput = fs.readFileSync(outPath).toString().trim();
                        if (userOutput === correctOutput) {
                            passedTests++;
                        } else {
                            status = `Wrong Answer on Test ${testId}`;
                            break; 
                        }
                    }
                } catch (execErr) { 
                    if (execErr.code === 'ETIMEDOUT') {
                        status = `Time Limit Exceeded on Test ${testId}`;
                    } else {
                        status = `Runtime Error on Test ${testId}`;
                    }
                    break; 
                }
            }

            if (inputFiles.length > 0) {
                totalPoints = Math.round((passedTests / inputFiles.length) * 100);
            }
        } else { 
            totalPoints = 100; 
        }
    }

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
        time: formattedDate 
    });
    writeData('submissions.json', allSubmissions);

    res.redirect(`/contest/${contestId}?task=${taskName}&view=submissions`);
});

// ==========================================
// 📊   ადმინის სკორბორდი
// ==========================================
app.get('/admin/scoreboard', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    
    const contestId = req.query.contestId;
    const contests = readData('contests.json');
    let selectedContest = contests.find(c => String(c.id) === String(contestId)) || null;
    
    let processedScoreboard = [];

    if (selectedContest) {
        const allSubmissions = readData('submissions.json');
        const contestSubmissions = allSubmissions.filter(s => String(s.contestId) === String(contestId));

        const userMap = {};

        contestSubmissions.forEach(sub => {
            const email = sub.email;
            const task = sub.taskName;
            const points = parseInt(sub.points) || 0;
            const subTime = new Date(sub.time);

            if (!userMap[email]) {
                userMap[email] = { email: email, tasks: {}, totalPoints: 0 };
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
    const { email, password = "" } = req.body;
    const students = readData('students.json', [{ email: 'student@gmail.com', password: '123' }]);
    if (students.some(s => s.email === email)) return res.render('register-student', { students, success: 'ეს მეილი გამოყენებულია!' });
    if (email && password) { students.push({ id: Date.now().toString(), email: email.trim(), password: password.trim() }); writeData('students.json', students); }
    res.redirect('/admin/register-student');
});

app.post('/admin/unregister-student', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const targetId = req.body.id || req.body.studentId; 
    let students = readData('students.json', [{ email: 'student@gmail.com', password: '123' }]);
    students = students.filter(s => String(s.id) !== String(targetId) && String(s._id) !== String(targetId));
    writeData('students.json', students);
    res.redirect('/admin/register-student');
});

// ==========================================
// კომუნიკაცია (Questions მიბმული კონტესტზე)
// ==========================================
app.get('/communication', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    
    const contestId = req.query.contestId || req.session.currentContestId || '';
    const allQuestions = readData('questions.json');
    
    // ვფილტრავთ მხოლოდ მიმდინარე კონტესტის კითხვებს
    let questions = allQuestions.filter(q => String(q.contestId) === String(contestId));
    
    if (req.session.role !== 'admin' && req.session.role !== 'owner') {
        questions = questions.filter(q => q.user === req.session.userEmail);
    }
    
    res.render('communication', { questions, role: req.session.role, contestId });
});

app.post('/ask-question', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const { subject, text, contestId } = req.body;
    if (text) {
        const allQuestions = readData('questions.json');
        allQuestions.push({ 
            id: Date.now().toString(), 
            _id: Date.now().toString(), 
            contestId: String(contestId), // ვინახავთ კონტესტის ID-ს
            user: req.session.userEmail, 
            subject, 
            text, 
            reply: '', 
            time: new Date().toLocaleTimeString() 
        });
        writeData('questions.json', allQuestions);
    }
    res.redirect(`/communication?contestId=${contestId}`);
});

app.post('/admin/reply-question', (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'owner') return res.status(403).send('წვდომა უარყოფილია');
    const { qId, contestId } = req.body;
    const allQuestions = readData('questions.json');
    const question = allQuestions.find(q => String(q.id) === String(qId) || String(q._id) === String(qId));
    if (question) { 
        question.reply = req.body.replyText; 
        writeData('questions.json', allQuestions); 
    }
    res.redirect(`/communication?contestId=${contestId}`);
});

// სერვერის გაშვება
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 სერვერი წარმატებით გადაეშვა სრულ რეჟიმში!`);
    console.log(`🔗 გახსენი ბრაუზერში: http://localhost:${PORT}`);
});