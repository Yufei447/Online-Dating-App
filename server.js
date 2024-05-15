const express = require('express');
const Handlebars = require('handlebars');
const exphbs = require('express-handlebars');
const { allowInsecurePrototypeAccess } = require('@handlebars/allow-prototype-access')
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const passport = require('passport');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcryptjs');
const formidable = require('formidable');
const app = express();
const port = process.env.PORT || 3000;

// Load models
const Message = require('./models/message');
const User = require('./models/user');
const Chat = require('./models/chat');
const Smile = require('./models/smile');
const Post = require('./models/post');
// load keys file
const Keys = require('./config/keys');
const stripe = require('stripe')(Keys.StripeSecretkey);
// Load helpers
const {requireLogin, ensureGuest} = require('./helpers/auth');
const {uploadImage} = require('./helpers/aws');
const {getLastMoment} = require('./helpers/moment');
const {walletChecker} = require('./helpers/wallet');
// load facebook strategy
require('./passport/facebook');
require('./passport/local');


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
// signup message prompt
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


// connect to mLab MongoDB
mongoose.connect(Keys.MongoDB).then(() => {
    console.log('Server is connected to MongoDB');
}).catch((err) => {
    console.log(err);
});

// setup a view engine
app.engine('handlebars', exphbs.engine({
    defaultLayout:'main',
    helpers: {
        getLastMoment:getLastMoment
    },
    handlebars: allowInsecurePrototypeAccess(Handlebars)}));
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
                // Display smile notification
                Smile.findOne({receiver:req.user._id,receiverReceived:false})
                .then((newSmile) => {
                    Chat.findOne({$or:[
                        {receiver:req.user._id,receiverRead:false},
                        {sender:req.user._id,senderRead:false}
                    ]})
                    .then((unread) => {
                        Post.find({postUser:req.user._id})
                           .populate('postUser')
                           .sort({date:'desc'})
                           .then((posts) => {
                               if (posts) {
                                  res.render('profile',{
                                      title: 'Profile',
                                      user: user,
                                      newSmile: newSmile,
                                      unread:unread,
                                      posts:posts
                                    });
                               }else{
                                   console.log('User does not have any posts');
                                   res.render('profile',{
                                       title: 'Profile',
                                       user: user,
                                       newSmile: newSmile,
                                       unread:unread
                                    });
                               }
                           })
                    })
                })
                
            })
            .catch(err => {
                throw err;
            });
        }
    });
});
app.post('/updateProfile',requireLogin,(req,res) => {
    User.findById({_id:req.user._id})
    .then((user) => {
        user.fullname = req.body.fullname;
        user.email = req.body.email;
        user.gender = req.body.gender;
        user.about = req.body.about;
        // user.save(() => {
        //     res.redirect('/profile');
        // });
        user.save()
        .then(() => {
            res.redirect('/profile');
        })
        .catch(err => {
            throw err;
        });

    });
});

app.get('/askToDelete',requireLogin,(req,res) => {
    res.render('askToDelete',{
        title: 'Delete'
    });
});
app.get('/deleteAccount',requireLogin,(req,res) => {
    User.deleteOne({_id:req.user._id})
    .then(() => {
        res.render('accountDeleted',{
            title:'Deleted'
        });
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
})

app.get('/retrievePwd',(req,res) => {
    res.render('retrievePwd',{
        title: 'Retrieve'
    })
});
app.post('/retrievePwd',(req,res) => {
    let email = req.body.email.trim();
    let pwd1 = req.body.password.trim();
    let pwd2 = req.body.password2.trim();

    if (pwd1 !== pwd2) {
        res.render('pwdDoesNotMatch',{
            title:'Not match'
        })
    }

    User.findOne({email:email})
    .then((user) => {
        let salt = bcrypt.genSaltSync(10);
        let hash = bcrypt.hashSync(pwd1,salt);

        user.password = hash;
        user.save()
        .then((user) => {
            res.render('pwdUpdated',{
                title:'Updated'
            })
        })
        .catch((err) => {
            throw err;
        })
    })
})

app.get('/uploadImage',requireLogin,(req,res)=>{
    res.render('uploadImage',{
        title:'Upload'
    });
});
// update the image property of the user in mongoDB database
app.post('/uploadAvatar',requireLogin,(req,res)=>{
    User.findById({_id:req.user._id})
    .then((user) => {
        user.image = `https://online-dating-app-bucket.s3.amazonaws.com/${req.body.upload}`;
        user.save()
        .then((user) => {
            res.redirect('/profile');
        })
        .catch((err) => {
            throw err;
        })
    });
});

app.post('/uploadFile',requireLogin,uploadImage.any(),(req,res) => {
    // parse image of form type using formidable
    const form = new formidable.IncomingForm();
    // when receive the file, the callback function will be filed
    form.on('file', (field,file) => {
        console.log(file);
    });
    form.on('error', (err) => {
        console.log(err);
    });
    form.on('end',() => {
        console.log('Image upload is successful ..');
    });
    form.parse(req);
});

app.get('/singles',requireLogin,(req,res) => {
    User.find({})
    .sort({date:'desc'})
    .then((singles) => {
        res.render('singles',{
            title:'Singles',
            singles:singles
        })
    }).catch((err) => {
        console.log(err);
    });
});
app.get('/userProfile/:id',requireLogin,(req,res) => {
    User.findById({_id:req.params.id})
    .then((user) => {
        Smile.findOne({receiver:req.params.id})
        .then((smile) => {
            Post.find({status:'public',postUser:user._id})
           .populate('postUser')
           .populate('comments.commentUser')
           .populate('likes.likeUser')
           .then((publicPosts) => {
               res.render('userProfile',{
                   title:'Profile',
                   oneUser: user,
                   smile:smile,
                   publicPosts:publicPosts
               });
           })
        })
    });
});

// Start chat process
app.get('/startChat/:id',requireLogin,(req,res) => {
    // Check if the id sends messages before or not, in this case, id is the sender
    // <receiver> is the current login user
    Chat.findOne({sender:req.params.id,receiver:req.user._id})
    .then((chat) => {
        // chat exists before
        if (chat){
            chat.receiverRead = true;
            // send back new message
            chat.senderRead = false;
            chat.date = new Date();
            chat.save()
            .then(chat => {
                if (chat) {
                    res.redirect(`/chat/${chat._id}`);
                }
            })
            .catch(err => {
                throw err;
            });
        }else{
            // Current user is the <sender>
            Chat.findOne({sender:req.user._id,receiver:req.params.id})
            .then((chat) => {
                if (chat) {
                    chat.senderRead = true;
                    chat.reciverRead = false;
                    chat.date = new Date();
                    chat.save()
                    .then(chat => {
                        if (chat) {
                            res.redirect(`/chat/${chat._id}`);
                        }
                    })
                    .catch(err => {
                        throw err;
                    });
                }
                else{
                    // New conversation
                    const newChat = {
                        sender: req.user._id,
                        receiver: req.params.id,
                        senderRead: true,
                        receiverRead: false,
                        date: new Date()
                    }
                    new Chat(newChat).save()
                    .then(chat => {
                        if (chat) {
                            res.redirect(`/chat/${chat._id}`);
                        }
                    })
                    .catch(err => {
                        throw err;
                    });
                }
            })
        }
    })
})
// Display Chat Room
app.get('/chat/:id([0-9a-f]{24})',requireLogin,(req,res) => {
    Chat.findById({_id:req.params.id})
    .populate('sender')
    .populate('receiver')
    .populate('chats.senderName')
    .populate('chats.receiverName')
    .then((chat) => {
        User.findOne({_id:req.user._id})
        .then((user) => {
            res.render('chatRoom',{
                title: 'Chat',
                user:user,
                chat:chat
            })
        })
    })
})
app.post('/chat/:id([0-9a-f]{24})',requireLogin,walletChecker,(req,res) => {
    Chat.findOne({_id:req.params.id,sender:req.user._id})
    .sort({date:'desc'})
    .populate('sender')
    .populate('receiver')
    .populate('chats.senderName')
    .populate('chats.receiverName')
    .then((chat) => {
        if (chat) {
            // sender sends message
            chat.senderRead = true;
            chat.receiverRead = false;
            chat.date = new Date();

            const newChat = {
                senderName:req.user._id,
                senderRead: true,
                receiverName: chat.receiver._id,
                receiverRead: false,
                date: new Date(),
                senderMessage: req.body.chat
            }
            chat.chats.push(newChat)
            chat.save()
            .then(chat => {
                if (chat) {
                    Chat.findOne({_id:chat._id})
                    .sort({date:'desc'})
                    .populate('sender')
                    .populate('receiver')
                    .populate('chats.senderName')
                    .populate('chats.receiverName')
                    .then((chat) => {
                        User.findById({_id:req.user._id})
                        .then((user) => {
                            // we will charge client for each message
                            user.wallet = user.wallet - 1;
                            user.save()
                            .then(user => {
                                if (user) {
                                    res.render('chatRoom',{
                                        title:'Chat',
                                        chat:chat,
                                        user:user
                                    })
                                }
                            })
                        })
                    })
                }
            })
            .catch(err => {
                throw err;
            })
        }else{
            // receiver sends message back
            Chat.findOne({_id:req.params.id,receiver:req.user._id})
            .sort({date:'desc'})
            .populate('sender')
            .populate('receiver')
            .populate('chats.senderName')
            .populate('chats.receiverName')
            .then((chat) => {
                chat.senderRead = true;
                chat.reciverRead = false;
                chat.date = new Date();
                const newChat = {
                    senderName: chat.sender._id,
                    senderRead: false,
                    receiverName: req.user._id,
                    reciverRead: true,
                    receiverMessage: req.body.chat,
                    date: new Date()
                }
                chat.chats.push(newChat)
                chat.save()
                .then(chat => {
                    if (chat) {
                        Chat.findOne({_id:chat._id})
                        .sort({date:'desc'})
                        .populate('sender')
                        .populate('receiver')
                        .populate('chats.senderName')
                        .populate('chats.receiverName')
                        .then((chat) => {
                            User.findById({_id:req.user._id})
                            .then((user) => {
                                // we will charge client for each message
                                user.wallet = user.wallet - 1;
                                user.save()
                                .then(user => {
                                    if (user) {
                                        res.render('chatRoom',{
                                            title:'Chat',
                                            chat:chat,
                                            user:user
                                        })
                                    }
                                })
                            })
                        })
                    }
                })
                .catch(err => {
                    throw err;
                })
            })
        }
    })
})

app.get('/sendSmile/:id',requireLogin,(req,res) => {
    const newSmile = {
        sender: req.user._id,
        receiver: req.params.id,
        senderSent: true
    }
    new Smile(newSmile).save()
    .then(smile => {
        res.redirect(`/userProfile/${req.params.id}`);
    })
    .catch(err => {
        throw err;
    });
})
app.get('/deleteSmile/:id',requireLogin,(req,res) => {
    Smile.deleteOne({receiver:req.params.id,sender:req.user._id})
    .then(() => {
        res.redirect(`/userProfile/${req.params.id}`);
    })
})
// show simle sender
app.get('/showSmile/:id',requireLogin,(req,res) => {
    Smile.findOne({_id:req.params.id})
    .populate('sender')
    .populate('receiver')
    .then((smile) => {
        smile.receiverReceived = true;
        smile.save()
        .then((smile) => {
            res.render('smile/showSmile', {
                title: 'NewSmile',
                smile: smile
            })
        })
        .catch(err => {
            throw err;
        });
        
    })
})

app.get('/chats',requireLogin,(req,res) => {
    Chat.find({receiver:req.user._id})
    .populate('sender')
    .populate('receiver')
    .populate('chats.senderName')
    .populate('chats.receiverName')
    .sort({date:'desc'})
    .then((received) => {
        Chat.find({sender:req.user._id})
        .populate('sender')
        .populate('receiver')
        .populate('chats.senderName')
        .populate('chats.receiverName')
        .sort({date:'desc'})
        .then((sent) => {
            res.render('chat/chats',{
                title: 'Chat History',
                received:received,
                sent:sent
            })
        })
    })
})
app.get('/deleteChat/:id',requireLogin,(req,res) => {
    Chat.deleteOne({_id:req.params.id})
    .then(() => {
        res.redirect('/chats');
    });
});

app.post('/charge10dollars',requireLogin,(req,res) => {
    console.log(req.body);
    const amount = 1000;
    stripe.customers.create({
        email:req.body.stripeEmail,
        source: req.body.stripeToken
    }).then((customer) => {
        return stripe.paymentIntents.create({
            amount:1000,
            description: '$10 for 20 messages',
            currency: 'usd',
            payment_method_types:['card'],
            customer:customer.id,
            receipt_email:customer.email
        }).then((charge) => {
            if (charge) {
                User.findById({_id:req.user._id})
                .then((user) => {
                    user.wallet += 20;
                    user.save()
                    .then(() => {
                        res.render('success',{
                            title:'Success',
                            charge:charge
                        })
                    })
                })
            }
        }).catch((err) => {
            console.log(err);
        })
    }).catch((err) => {
        console.log(err);
    })
})
app.post('/charge20dollars',requireLogin,(req,res) => {
    console.log(req.body);
    const amount = 2000;
    stripe.customers.create({
        email:req.body.stripeEmail,
        source: req.body.stripeToken
    }).then((customer) => {
        return stripe.paymentIntents.create({
            amount:2000,
            description: '$20 for 50 messages',
            currency: 'usd',
            payment_method_types:['card'],
            customer:customer.id,
            receipt_email:customer.email
        }).then((charge) => {
            if (charge) {
                User.findById({_id:req.user._id})
                .then((user) => {
                    user.wallet +=50;
                    user.save()
                    .then(() => {
                        res.render('success',{
                            title:'Success',
                            charge:charge
                        })
                    })
                })
            }
        }).catch((err) => {
            console.log(err);
        })
    }).catch((err) => {
        console.log(err);
    })
})
app.post('/charge30dollars',requireLogin,(req,res) => {
    console.log(req.body);
    const amount = 3000;
    stripe.customers.create({
        email:req.body.stripeEmail,
        source: req.body.stripeToken
    }).then((customer) => {
        return stripe.paymentIntents.create({
            amount:3000,
            description: '$30 for 100 messages',
            currency: 'usd',
            payment_method_types:['card'],
            customer:customer.id,
            receipt_email:customer.email
        }).then((charge) => {
            if (charge) {
                User.findById({_id:req.user._id})
                .then((user) => {
                    user.wallet +=100;
                    user.save()
                    .then(() => {
                        res.render('success',{
                            title:'Success',
                            charge:charge
                        })
                    })
                })
            }
        }).catch((err) => {
            console.log(err);
        })
    }).catch((err) => {
        console.log(err);
    })
})
// Charge 40 dollars
app.post('/charge40dollars',requireLogin,(req,res) => {
    console.log(req.body);
    const amount = 4000;
    stripe.customers.create({
        email:req.body.stripeEmail,
        source: req.body.stripeToken
    }).then((customer) => {
        return stripe.paymentIntents.create({
            amount:4000,
            description: '$40 for 200 messages',
            currency: 'usd',
            payment_method_types:['card'],
            customer:customer.id,
            receipt_email:customer.email
        }).then((charge) => {
            if (charge) {
                User.findById({_id:req.user._id})
                .then((user) => {
                    user.wallet +=200;
                    user.save()
                    .then(() => {
                        res.render('success',{
                            title:'Success',
                            charge:charge
                        })
                    })
                })
            }
        }).catch((err) => {
            console.log(err);
        })
    }).catch((err) => {
        console.log(err);
    })
});

app.get('/displayPostForm',requireLogin,(req,res) => {
    res.render('post/displayPostForm',{
        title: 'Post'
    });
})
app.post('/createPost',requireLogin,(req,res) => {
    let allowComments = Boolean;
    if (req.body.allowComments) {
        allowComments = true;
    }else{
        allowComments = false;
    }
    const newPost = {
        title: req.body.title,
        body: req.body.body,
        status: req.body.status,
        image: `https://online-dating-app-bucket.s3.amazonaws.com/${req.body.image}`,
        postUser: req.user._id,
        allowComments: allowComments,
        date: new Date()
    }
    if (req.body.status === 'public') {
        newPost.icon = 'fa fa-globe';
    }
    if (req.body.status === 'private') {
        newPost.icon = 'fa fa-key';
    }
    if (req.body.status === 'friends') {
        newPost.icon = 'fa fa-group';
    }
    new Post(newPost).save()
    .then(() => {
        if (req.body.status === 'public') {
            res.redirect('/posts');
        }else{
            res.redirect('/profile');
        }
    })
})
// DISPLAY ALL PUBLIC POSTS
app.get('/posts',requireLogin,(req,res) => {
    Post.find({status:'public'})
    .populate('postUser')
    .sort({date:'desc'})
    .then((posts) => {
        res.render('post/posts',{
            title:'Posts',
            posts:posts
        })
    })
})
app.get('/deletePost/:id',requireLogin,(req,res) => {
    Post.deleteOne({_id:req.params.id})
    .then(() => {
        res.redirect('/profile');
    })
})
app.get('/editPost/:id',requireLogin,(req,res) => {
    Post.findById({_id:req.params.id})
    .then((post) => {
        res.render('post/editPost',{
            title:'Editing',
            post:post
        })
    })
})
app.post('/editPost/:id',requireLogin,(req,res) => {
    Post.findByIdAndUpdate({_id:req.params.id})
    .then((post) => {
        let allowComments = Boolean;
        if (req.body.allowComments) {
            allowComments = true;
        }else{
            allowComments = false;
        }
        post.title = req.body.title;
        post.body = req.body.body;
        post.status = req.body.status;
        post.allowComments = allowComments;
        post.image = `https://online-dating-app.s3.ap-south-1.amazonaws.com/${req.body.image}`;
        post.date = new Date()

        if (req.body.status === 'public') {
            post.icon = 'fa fa-globe';
        }
        if (req.body.status === 'private') {
            post.icon = 'fa fa-key';
        }
        if (req.body.status === 'friends') {
            post.icon = 'fa fa-group';
        }
        post.save()
        .then(() => {
            res.redirect('/profile');
        })
    })
})
// When user click like of a post, push the user into the post's like's array
app.get('/likePost/:id',requireLogin,(req,res) => {
    Post.findById({_id:req.params.id})
    .then((post) => {
        const newLike = {
            likeUser: req.user._id,
            date: new Date()
        }
        post.likes.push(newLike)
        post.save()
        .then(post => {
            res.redirect(`/fullPost/${post._id}`);
        })
        .catch((err) => {
            throw err;
        })
    })
})
app.get('/fullpost/:id',requireLogin,(req,res) => {
    Post.findById({_id:req.params.id})
    .populate('postUser')
    .populate('likes.likeUser')
    .populate('comments.commentUser')
    .sort({date:'desc'})
    .then((post) => {
        res.render('post/fullpost',{
            title:'Full Post',
            post:post
        })
    })
})
// Submit form to leave comment
app.post('/leaveComment/:id',requireLogin,(req,res) => {
    Post.findById({_id:req.params.id})
    .then((post) => {
        const newComment = {
            commentUser: req.user._id,
            commentBody: req.body.commentBody,
            date: new Date()
        }
        post.comments.push(newComment)
        post.save()
        .then((post) => {
            res.redirect(`/fullpost/${post._id}`);
        })
        .catch((err) => {
            throw err;
        })
    })
})
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