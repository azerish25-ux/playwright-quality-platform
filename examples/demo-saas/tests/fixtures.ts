import {test as base,expect,type APIRequestContext,type Page} from '@playwright/test';
import {createForgeTest,withAuthentication} from '@azerish25-ux/forgeqa-playwright';
import {ResourceScope,withResourceScope} from '@azerish25-ux/forgeqa-core';
import {ForgeHttpClient} from '@azerish25-ux/forgeqa-api';
import {defineDataFactory} from '@azerish25-ux/forgeqa-test-data';
import {randomUUID} from 'node:crypto';
import {teamboardAuthentication,teamboardIdentity} from './adapters.js';
export interface Tenant {namespace:string;cleanupKey:string;workspaceId:string;projectId:string;accounts:Record<'owner'|'editor'|'viewer',{email:string;password:string;id:string}>}
export const taskFactory=defineDataFactory('teamboard-task',ctx=>({title:`Task ${ctx.integer(1000,9999)}`,status:'todo'}));
export const test=createForgeTest(base).extend<{tenant:Tenant;owner:APIRequestContext;editor:APIRequestContext;viewer:APIRequestContext}>({
  tenant:async({forge},use)=>{
    const namespace=`${forge.namespace}-${randomUUID()}`;
    await withResourceScope(new ResourceScope(namespace),async scope=>{
      const client=new ForgeHttpClient(forge.config.baseUrl,{'x-forgeqa-token':process.env.TEAMBOARD_TEST_TOKEN??''});
      const {data}=await client.post<Tenant>('/__test/seed',{namespace});
      scope.defer({id:'tenant',cleanup:async signal=>{
        const cleaned=await client.post<{remaining:number}>('/__test/cleanup',{namespace:data.namespace,cleanupKey:data.cleanupKey},{signal,timeoutMs:4_000});
        expect(cleaned.data.remaining,'owned tenant cleanup removes users and workspaces').toBe(0);
      }});
      await use(data);
    });
  },
  owner:async({tenant,forge},use,info)=>{await withAuthentication(teamboardAuthentication(forge.config.baseUrl,tenant),teamboardIdentity(forge,info,tenant,'owner'),use);},
  editor:async({tenant,forge},use,info)=>{await withAuthentication(teamboardAuthentication(forge.config.baseUrl,tenant),teamboardIdentity(forge,info,tenant,'editor'),use);},
  viewer:async({tenant,forge},use,info)=>{await withAuthentication(teamboardAuthentication(forge.config.baseUrl,tenant),teamboardIdentity(forge,info,tenant,'viewer'),use);},
});
export async function loginPage(page:Page,tenant:Tenant,role:'owner'|'editor'|'viewer'='owner'):Promise<void>{
  await page.goto('/');
  const signOut=page.getByRole('button',{name:'Sign out',exact:true});
  if(await signOut.isVisible()){
    const response=await page.request.post(new URL('/api/logout',page.url()).toString(),{data:{}});
    expect([200,401],'role transition logout is complete or already complete').toContain(response.status());
    await page.context().clearCookies();
    await page.goto('/');
  }
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await page.getByLabel('Email',{exact:true}).fill(tenant.accounts[role].email);
  await page.getByLabel('Password',{exact:true}).fill(tenant.accounts[role].password);
  await Promise.all([
    page.waitForResponse(response=>response.url().endsWith('/api/login')&&response.request().method()==='POST'&&response.ok()),
    page.getByRole('button',{name:'Sign in',exact:true}).click()
  ]);
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  await expect(page.getByText(tenant.accounts[role].email,{exact:true})).toBeVisible();
}
export async function logoutPage(page:Page):Promise<void>{
  const [response]=await Promise.all([
    page.waitForResponse(value=>value.url().endsWith('/api/logout')&&value.request().method()==='POST'),
    page.getByRole('button',{name:'Sign out',exact:true}).click()
  ]);
  expect(response.status(),'logout completes before any navigation or role transition').toBe(200);
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
}
export {expect};
