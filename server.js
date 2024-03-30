const express = require('express');
const handlebars = require('handlebars')
const exphbs = require('express-handlebars');
const { allowInsecurePrototypeAccess } = require('@handlebars/allow-prototype-access')
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const passport = require('passport');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcryptjs');
// Load models
const Message = require('./models/message');
const User = require('./models/user');
const app = express();
// load keys file
const Keys = require('./config/keys');
// Load helpers
const {requireLogin, ensureGuest} = require('./helpers/auth');
// use body parser middleware
app.use(bodyParser.urlencoded({extended:false}));
app.use(bodyParser.json());
// configuration for authentication
app.use(cookieParser());
app.use(session({
    secret: 'mysecret',
    resave: true,
    saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use((req,res,next)=> {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    next();
});
// setup express static folder to server js, css files
app.use(express.static('public'));
// Make user global object
app.use((req,res,next) => {
    res.locals.user = req.user || null;
    next();
});
// load facebook strategy
require('./passport/facebook');
require('./passport/local');
// connect to mLab MongoDB
mongoose.connect(Keys.MongoDB).then(() => {
    console.log('Server is connected to MongoDB');
}).catch((err) => {
    console.log(err);
});
// environment var for port
const port = process.env.PORT || 3000;
// setup a view engine
app.engine('handlebars', exphbs.engine({
    defaultLayout:'main',
    handlebars: allowInsecurePrototypeAccess(handlebars)
}));
app.set('view engine', 'handlebars');

app.get('/', ensureGuest,(req, res) => {
    res.render('home', {
        title: 'Home'
    });
});

app.get('/about', ensureGuest, (req, res) => {
    res.render('about', {
        title: 'About'
    });
});

app.get('/contact', ensureGuest, (req, res) => {
    res.render('contact', {
        title: 'Contact'
    });
});

app.get('/auth/facebook', passport.authenticate('facebook', {
    scope: ['email']
}));
app.get('/auth/facebook/callback', passport.authenticate('facebook', {
    successRedirect: '/profile',
    failureRedirect: '/'
}));
app.get('/profile', requireLogin, (req,res) => {
    User.findById({_id:req.user._id}).then((user) => {
        if (user) {
            user.online = true;
            user.save()
            .then(savedUser => {
                res.render('profile', {
                title: 'Profile',
                user: savedUser
                });
            })
            .catch(err => {
                throw err;
            });
        }
    });
});
app.get('/newAccount', (req,res) => {
    res.render('newAccount', {
        title: 'Signup'
    });
});
app.post('/signup', (req,res) => {
    // console.log(req.body);
    let errors = [];
    if (req.body.password !== req.body.password2) {
        errors.push({text: 'Password does not match'});
    }
    if (req.body.password.length < 5){
        errors.push({text: 'Password must be at least 5 characters'});
    }
    if (errors.length > 0) {
        res.render('newAccount', {
            errors: errors,
            title: 'Error',
            fullname: req.body.username,
            email: req.body.email,
            password: req.body.password,
            password2: req.body.password2
        })
    }else{
        User.findOne({email:req.body.email})
        .then((user) => {
            if (user) {
                let errors = [];
                errors.push({text:'Email already exist'});
                res.render('newAccount', {
                    title: 'Signup',
                    errors:errors
                })
            }else{
                var salt = bcrypt.genSaltSync(10);
                var hash = bcrypt.hashSync(req.body.password, salt);
                
                const newUser = {
                    fullname: req.body.username,
                    email: req.body.email,
                    password: hash
                }
                new User(newUser).save()
                .then(user => {
                    let success = [];
                    success.push({text: 'Your account has been successfully created. You can login now'});
                    res.render('home', {
                    success: success
                    });
                })
                .catch(err => {
                    throw err;
                });
            }
        });
    }
});
app.post('/login', passport.authenticate('local',{
    successRedirect: '/profile',
    failureRedirect: '/loginErrors'
}));
app.get('/loginErrors', (req,res) => {
    let errors = [];
    errors.push({text:'User Not found or Password Incorrect'})
    res.render('home', {
        errors: errors
    });
});
app.get('/logout',(req,res)=>{
    User.findById({_id:req.user._id})
    .then((user) => {
        user.online = false;
        user.save()
        .then(savedUser => {
            if (savedUser) {
            req.logOut(function(err) {
                if (err) { return next(err); } // Handle error if necessary
                res.redirect('/');
              });
            }
        })
        .catch(err => {
            throw err;
        });

    });
});

app.post('/contactUs',(req,res) => {
    console.log(req.body);
    const newMessage = {
        fullname: req.body.fullname,
        email: req.body.email,
        message: req.body.message,
        date: new Date()
    }
    async function saveAndFindMessages() {
        try {
            await new Message(newMessage).save(); // Save the new message
            const messages = await Message.find({}); // Find all messages
            
            if (messages) {
                // If messages exist, render the 'newmessage' view with the messages
                res.render('newmessage', {
                    title: 'Sent',
                    messages: messages
                });
            } else {
                // If no messages are found, render the 'noMessage' view
                res.render('noMessage', {
                    title: 'Not found'
                });
            }
        } catch (error) {
            // Handle any errors that occur during the save or find operations
            console.error(error);
            res.status(500).send('An error occurred');
        }
    }
    saveAndFindMessages();
    
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});