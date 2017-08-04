import { User } from './../types/user';
import { Request, Response } from 'express';
import axios from 'axios';

import { config } from '../config';

/*
 * TODO: azure getTenants
 */
export function getTenants(req: Request, res: Response) {
    const user = req.user as User;
    if (req.url.indexOf('localhost') !== -1) { }
    const headers = {
        'Authorization': `Bearer ${user.token.access_token}`
    };

    axios.get(`${config.azureResourceManagerEndpoint}/tenants?api-version=2017-06-01`, { headers: headers })
        .then(r => {
            const tenants = r.data
                .value
                .map((t: { tenantId: string }) => ({
                    DisplayName: t.tenantId,
                    DomainName: t.tenantId,
                    TenantId: t.tenantId,
                    Current: t.tenantId.toUpperCase() === user.tid.toUpperCase()
                }));
            res.json(tenants);
        })
        .catch(err => res.status(500).send(err));
}


export function switchTenant(req: Request, res: Response) {
    const params: { tenantId: string } = req.params;
    res.json({
        name: params.tenantId
    });
}

export function getToken(req: Request, res: Response) {
    const user = req.user as User;
    if (req.query.plaintext) {
        res.send(user.token.access_token);
    } else {
        res.json(user);
    }
}