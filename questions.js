// Server-only. This file is never served to browsers, so `answer` cannot leak.
// To add a question: append an object. `answer` is the index (0-3) of the correct option.

module.exports = [
  {
    text: 'Using the Rule of 72, roughly how long does money take to double at 8% a year?',
    options: ['4 years', '9 years', '14 years', '20 years'],
    answer: 1,
    source: 'https://www.investor.gov/additional-resources/information/youth/teachers-classroom-resources/what-compound-interest',
  },
  {
    text: 'You invest 10,000 at 10% interest, compounded yearly. What is it worth after 2 years?',
    options: ['11,000', '12,000', '12,100', '20,000'],
    answer: 2,
    source: 'https://www.investor.gov/financial-tools-calculators/calculators/compound-interest-calculator',
  },
  {
    text: 'Your savings earn 7% a year while inflation is 4%. What is your real return, approximately?',
    options: ['11%', '7%', '4%', '3%'],
    answer: 3,
    source: 'https://www.federalreserveeducation.org/teaching-resources/economics/banks-interest-rates/getting-real-about-interest-rates',
  },
  {
    text: 'What does diversifying your investments mainly do?',
    options: [
      'Guarantees a profit',
      'Reduces the damage any single investment can do',
      'Removes all risk',
      'Doubles your returns',
    ],
    answer: 1,
    source: 'https://www.investor.gov/introduction-investing/getting-started/asset-allocation',
  },
  {
    text: 'If you pay only the minimum on a credit card each month, what happens?',
    options: [
      'The debt is cleared within a year',
      'You pay no interest',
      'You pay interest on the rest and take much longer to clear it',
      'Your credit limit is cut to zero',
    ],
    answer: 2,
    source: 'https://www.consumerfinance.gov/ask-cfpb/a-box-on-my-credit-card-bill-says-that-i-will-pay-off-the-balance-in-three-years-if-i-pay-a-certain-amount-what-does-that-mean-do-i-have-to-pay-that-much-if-i-pay-that-much-and-make-new-purchases-will-i-still-owe-nothing-after-three-years-en-36/',
  },
];
