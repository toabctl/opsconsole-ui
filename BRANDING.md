# (c) Copyright 2016 Hewlett Packard Enterprise Development LP
# Ops Console Branding


To update the branding of the Ops Console UI, several files need to be updated on the branch on which the desired product is being built.

# the following 3 files contain the product name labels displayed to the user
app/locales/en/branding.json
app/locales/ja/branding.json
app/locales/zh/branding.json
for example, the 3 files above should have the following entries for the CloudSystem branch of the Ops Console:
    "branding.product.login.title" : "HPE Helion CloudSystem",
    "branding.pageTitle.title" : "HPE Helion CloudSystem Operations Console",
    "branding.masthead.title": "HPE Helion CloudSystem Operations Console",


# the following file contains the declaration of the login artwork and masthead logos used
app/styles/components/_branding.scss

# the following files need to be replaced with vendor specific files:
images/icons/logos/login-logo.png
images/login-background.png