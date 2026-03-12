const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize("chat2", "root", '', {
  host: 'localhost',
  dialect: 'mysql' 
});

async function testConnection() {
  try {
    await sequelize.authenticate();
  } catch (error) {

  }
}

testConnection();

module.exports = sequelize;