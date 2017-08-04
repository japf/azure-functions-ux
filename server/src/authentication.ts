import { Request, Response, NextFunction, Application } from 'express';
import * as passport from 'passport';
import * as jwt from 'jsonwebtoken';
//import * as strategy from 'passport-azure-ad-oauth2';
import * as uuid4 from 'uuid/v4';
const strategy = require('passport-azure-ad-oauth2');

import { User, Token } from './types/user';
import { constants } from './constants';

export function setupAuthentication(app: Application) {
    passport.use(authStrategy());
    passport.serializeUser(serializeUser);
    passport.deserializeUser(deserializeUser);

    app.get('/.login',
        passport.authenticate('azure_ad_oauth2', { failureRedirect: '/.login/error', }),
        (_, res) => {
            // Successful authentication, redirect home.
            res.redirect('/');
        });

    app.get('/manage',
        passport.authenticate('azure_ad_oauth2', { failureRedirect: '/.login/error' }),
        (_, res) => {
            // Successful authentication, redirect home.
            res.redirect('/');
        });

    app.get('/.login/error', (_, res) => {
        res.status(500).send('There was an error in login');
    });
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
    if (req.isAuthenticated() && req.path.startsWith('/api/switchtenants/')) {
        const tenant = req.path.split('/')
            .filter(s => !!s)
            .pop();
        if (tenant) {
            const url = 'https://login.microsoftonline.com/' +
                tenant +
                '/oauth2/authorize' +
                '?response_type=id_token code' +
                `&redirect_uri=${constants.authentication.redirectUrl}` +
                `&client_id=${process.env.AADClientId}` +
                `&resource=${constants.authentication.resource}` +
                `&scope=${constants.authentication.scope}` +
                `&nonce=${uuid4()}` +
                '&site_id=500879' +
                `&response_mode=query` +
                `&state=`;
            res.redirect(url);
        } else {
            next();
        }
    } else if (req.isAuthenticated()) {
        return next();
    }

    res.redirect('/.login');
}

export function maybeAuthenticate(req: Request, res: Response, next: NextFunction) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/.login');
}

function authStrategy() {
    const strategyConfig = {
        clientID: process.env.AADClientId,
        clientSecret: process.env.AADClientSecret,
        callbackURL: constants.authentication.redirectUrl,
        resource: constants.authentication.resource
    };

    const userReducer = (_: string, __: string, params: Token, ___: any, done: any) => {
        const user = jwt.decode(params.id_token) as User;
        user.token = params;
        done(null, user);
    };
    return new strategy(strategyConfig, userReducer);
}

function deserializeUser(user: User, done: any) {
    done(null, user);
}

function serializeUser(user: User, done: any) {
    done(null, user);
}