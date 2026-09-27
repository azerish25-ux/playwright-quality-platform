import {test as base,expect,request as requests,type APIRequestContext,type Page} from '@playwright/test';
import {createForgeTest} from '@azerish25-ux/forgeqa-playwright';
import {ForgeHttpClient} from '@azerish25-ux/forgeqa-api';
import {defineDataFactory} from '@azerish25-ux/forgeqa-test-data';
import {randomUUID} from 'node:crypto';
export interface Tenant {namespace:string;cleanupKey:string;workspaceId:string;projectId:string;accounts:Record<'owner'|'editor'|'viewer',{email:string;password:string;id:string}>}
export const taskFactory=defineDataFactory('teamboard-task',ctx=>({title:`Task ${ctx.integer(1000,9999)}`,status:'todo'}));
export const test=createForgeTest(base).extend<{tenant:Tenant;owner:APIRequestContext;editor:APIRequestContext;viewer:APIRequestContext}>({
  tenant:async({forge},use)=>{const client=new ForgeHttpClient(forge.config.baseUrl,{'x-forgeqa-token':process.env.TEAMBOARD_TEST_TOKEN??''});const {data}=await client.post<Tenant>('/__test/seed',{namespace:`${forge.namespace}-${randomUUID()}`});try{await use(data);}finally{const cleaned=await client.post<{remaining:number}>('/__test/cleanup',{namespace:data.namespace,cleanupKey:data.cleanupKey});expect(cleaned.data.remaining,'owned tenant cleanup removes users and workspaces').toBe(0);}},
  owner:async({tenant,baseURL},use)=>{const context=await loginContext(baseURL!,tenant,'owner');try{await use(context);}finally{await context.dispose();}},
  editor:async({tenant,baseURL},use)=>{const context=await loginContext(baseURL!,tenant,'editor');try{await use(context);}finally{await context.dispose();}},
  viewer:async({tenant,baseURL},use)=>{const context=await loginContext(baseURL!,tenant,'viewer');try{await use(context);}finally{await context.dispose();}},
});
export async function loginContext(baseURL:string,tenant:Tenant,role:'owner'|'editor'|'viewer'):Promise<APIRequestContext>{const context=await requests.newContext({baseURL});const account=tenant.accounts[role];const response=await context.post('/api/login',{data:{email:account.email,password:account.password}});expect(response.status()).toBe(200);return context;}
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
export {expect};
