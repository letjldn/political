# Scoring Model

## Overview

The questionnaire should not score users directly against parties at first.

It should first build a hidden values profile.

Then it compares that profile against party profiles.

## Step 1: Convert Answers

For 7-point questions:

```js
value = (answer - 4) / 3
