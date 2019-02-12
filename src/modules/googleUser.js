/**
 * Copyright © 2015 - 2018 The Broad Institute, Inc. All rights reserved.
 * Licensed under the BSD 3-clause license (https://github.com/broadinstitute/gtex-viz/blob/master/LICENSE.md)
 */
/****** Google SignIn ******/
export function googleFunc(){
    return {
        checkSignedIn: checkSignedIn,
        getUser: getUser,
        signInButton: renderSignInButton,
        signOut: signOut,
        grantScopes: grantScopes
    }
}

function renderSignInButton(){
    gapi.signin2.render('my-signin2', {
        'scope': 'profile email',
        'width': 130,
        'height': 30,
        'longtitle': false,
        'theme': 'dark',
        'onsuccess': onSuccess,
        'onfailure': onFailure
    })
}

function onSuccess(googleUser){
    $('#g-signout').show();
}

function signOut() {
    let auth2 = gapi.auth2.getAuthInstance();
    auth2.signOut().then(function() {
        console.log('User signed out');
    });
    $('#g-signout').hide();
}

function onFailure(error){
    console.error(error)
}

function checkSignedIn(){
    if (gapi.auth2) {
        return getUser().isSignedIn();
    } else {
        return false;
    }
}

function getUser(){
    return gapi.auth2.getAuthInstance().currentUser.get()
}

function grantScopes(scopes){
    this.getUser().grant({scope: scopes}).then(
        function(success){
            console.log(JSON.stringify({message: "success", value: success}));
        },
        function(fail){
            console.error(JSON>stringify({message: "fail", value: fail}));
        }
    );
}