﻿using AzureFunctions.Code;
using AzureFunctions.Common;
using AzureFunctions.Models;
using AzureFunctions.Models.ArmModels;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using System.Web;
using System.Web.Hosting;
using System.Web.Http;

namespace AzureFunctions.Controllers
{
    public class AzureFunctionsController : ApiController
    {
        [Authorize]
        [HttpPost]
        public async Task<HttpResponseMessage> InitializeUser()
        {
            using (var client = GetClient())
            {
                // Get first sub
                var subscriptionsResponse = await client.GetAsync(ArmUriTemplates.Subscriptions.Bind(string.Empty));
                subscriptionsResponse.EnsureSuccessStatusCode();
                var subscriptions = await subscriptionsResponse.Content.ReadAsAsync<ArmSubscriptionsArray>();
                var subscription = subscriptions.value.FirstOrDefault(s => s.displayName.IndexOf("msdn") != -1) ?? subscriptions.value.FirstOrDefault();

                // look for a rg that starts with AzureFunctionsResourceGroup
                var resourceGroupsResponse = await client.GetAsync(ArmUriTemplates.ResourceGroups.Bind(new { subscriptionId = subscription.subscriptionId }));
                resourceGroupsResponse.EnsureSuccessStatusCode();
                var resourceGroups = await resourceGroupsResponse.Content.ReadAsAsync<ArmArrayWrapper<ArmResourceGroup>>();
                var resourceGroup = resourceGroups.value.FirstOrDefault(rg => rg.name.Equals("AzureFunctionsResourceGroup", StringComparison.OrdinalIgnoreCase));
                if (resourceGroup == null)
                {
                    //create it
                    var createRGResponse = await client.PutAsJsonAsync(ArmUriTemplates.ResourceGroup.Bind(new { subscriptionId = subscription.subscriptionId, resourceGroupName = "AzureFunctionsResourceGroup" }), new { properties = new { }, location = "West US" });
                    createRGResponse.EnsureSuccessStatusCode();
                    resourceGroup = await createRGResponse.Content.ReadAsAsync<ArmWrapper<ArmResourceGroup>>();
                }

                // look for a site that starts with AzureFunctionsContainer{random}
                var sitesResponse = await client.GetAsync(ArmUriTemplates.Sites.Bind(new { subscriptionId = subscription.subscriptionId, resourceGroupName = resourceGroup.name }));
                sitesResponse.EnsureSuccessStatusCode();
                var sites = await sitesResponse.Content.ReadAsAsync<ArmArrayWrapper<ArmWebsite>>();
                var site = sites.value.FirstOrDefault(s => s.name.StartsWith("AzureFunctionsContainer", StringComparison.OrdinalIgnoreCase));
                string scmUrl = null;
                if (site == null)
                {
                    //register the provider just in case
                    await client.PostAsync(ArmUriTemplates.WebsitesRegister.Bind(new { subscriptionId = subscription.subscriptionId, resourceGroupName = resourceGroup.name }), new StringContent(string.Empty));

                    //create website
                    var siteName = $"AzureFunctionsContainer{Guid.NewGuid().ToString().Replace("-", "")}";
                    var createSiteResponse = await client.PutAsJsonAsync(ArmUriTemplates.Site.Bind(new { subscriptionId = subscription.subscriptionId, resourceGroupName = resourceGroup.name, siteName = siteName }), new { properties = new { }, location = resourceGroup.location });
                    createSiteResponse.EnsureSuccessStatusCode();
                    site = await createSiteResponse.Content.ReadAsAsync<ArmWrapper<ArmWebsite>>();
                    scmUrl = $"https://{site.properties.enabledHostNames.FirstOrDefault(h => h.IndexOf(".scm.", StringComparison.OrdinalIgnoreCase) != -1) }";

                    // publish private kudu
                    using (var stream = File.OpenRead(@"D:\home\site\Functions\App_Data\Kudu.zip"))
                    {
                        var pKuduResponse = await client.PutAsync($"{scmUrl}/api/zip", new StreamContent(stream));
                        pKuduResponse.EnsureSuccessStatusCode();
                        pKuduResponse = await client.DeleteAsync($"{scmUrl}/api/processes/0");
                        pKuduResponse.EnsureSuccessStatusCode();
                    }
                }
                else
                {
                    scmUrl = $"https://{site.properties.enabledHostNames.FirstOrDefault(h => h.IndexOf(".scm.", StringComparison.OrdinalIgnoreCase) != -1) }";
                }


                sitesResponse = await client.PostAsync(ArmUriTemplates.ListSiteAppSettings.Bind(new { subscriptionId = subscription.subscriptionId, resourceGroupName = resourceGroup.name, siteName = site.name }), new StringContent(string.Empty));
                sitesResponse.EnsureSuccessStatusCode();
                var appSettings = await sitesResponse.Content.ReadAsAsync<ArmWrapper<Dictionary<string, string>>>();
                if (!appSettings.properties.ContainsKey(Constants.AzureStorageAppSettingsName))
                {
                    // create storage account
                    var storageResponse = await client.GetAsync(ArmUriTemplates.StorageAccounts.Bind(new { subscriptionId = subscription.subscriptionId, resourceGroupName = resourceGroup.name }));
                    storageResponse.EnsureSuccessStatusCode();
                    var storageAccounts = await storageResponse.Content.ReadAsAsync<ArmArrayWrapper<ArmStorage>>();
                    var storageAccount = storageAccounts.value.FirstOrDefault(s =>
                        s.name.StartsWith("AzureFunctions", StringComparison.OrdinalIgnoreCase) &&
                        s.properties.provisioningState.Equals("Succeeded", StringComparison.OrdinalIgnoreCase));

                    if (storageAccount == null)
                    {
                        var storageAccountName = $"AzureFunctions{Guid.NewGuid().ToString().Split('-').First()}".ToLowerInvariant();
                        storageResponse = await client.PutAsJsonAsync(ArmUriTemplates.StorageAccount.Bind(
                            new { subscriptionId = subscription.subscriptionId, resourceGroupName = resourceGroup.name, storageAccountName = storageAccountName }),
                            new { location = "West US", properties = new { accountType = "Standard_GRS" } });
                        storageResponse.EnsureSuccessStatusCode();
                        storageAccount = await storageResponse.Content.ReadAsAsync<ArmWrapper<ArmStorage>>();
                    }

                    storageResponse = await client.PostAsync(ArmUriTemplates.StorageListKeys.Bind(new { subscriptionId = subscription.subscriptionId, resourceGroupName = resourceGroup.name, storageAccountName = storageAccount.name }), new StringContent(string.Empty));
                    storageResponse.EnsureSuccessStatusCode();
                    var key = (await storageResponse.Content.ReadAsAsync<dynamic>()).key1;
                    appSettings.properties[Constants.AzureStorageAppSettingsName] = string.Format(Constants.StorageConnectionStringTemplate, storageAccount.name, key);

                    //save it
                    sitesResponse = await client.PutAsJsonAsync(ArmUriTemplates.PutSiteAppSettings.Bind(new { subscriptionId = subscription.subscriptionId, resourceGroupName = resourceGroup.name, storageAccountName = storageAccount.name }), new { properties = appSettings.properties });
                    sitesResponse.EnsureSuccessStatusCode();
                }

                // return it's scm name
                return Request.CreateResponse(HttpStatusCode.OK, new { scm_url = scmUrl });
            }
        }

        [Authorize]
        [HttpPost]
        public async Task<HttpResponseMessage> Passthrough(PassthroughInfo passthroughInfo)
        {
            using (var client = GetClient())
            {
                var request = new HttpRequestMessage(
                    new HttpMethod(passthroughInfo.HttpMethod), passthroughInfo.Url + (string.IsNullOrEmpty(passthroughInfo.QueryString) ? string.Empty : $"?{passthroughInfo.QueryString}"));
                if (passthroughInfo.RequestBody != null)
                {
                    request.Content = new StringContent(passthroughInfo.RequestBody.ToString(), Encoding.UTF8, Constants.ApplicationJson);
                }
                return await client.SendAsync(request);
            }
        }

        private HttpClient GetClient(string baseUri = null)
        {
            var client = new HttpClient();
            if (!string.IsNullOrEmpty(baseUri))
            {
                client.BaseAddress = new Uri(baseUri);
            }
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
                Request.Headers.GetValues(Constants.X_MS_OAUTH_TOKEN).FirstOrDefault());
            client.DefaultRequestHeaders.Add("User-Agent", Request.RequestUri.Host);
            client.DefaultRequestHeaders.Add("Accept", Constants.ApplicationJson);
            return client;
        }
    }
}