module.exports = {
    requireLogin: (req,res,next) => {
        // user is logged in
        if (req.isAuthenticated()){
            return next();
        }else{
            res.redirect('/')
        }
    },
    ensureGuest: (req,res,next) => {
        if (req.isAuthenticated()) {
            res.redirect('/profile')
        }else{
            return next();
        }
    }
}