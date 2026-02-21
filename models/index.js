const sequelize = require('../config/database');
const User = require('./User');
const Chat = require('./Chat');
const CustomApi = require('./CustomApi');
const Setting = require('./Setting');

// Sync all models with database
const syncDatabase = async (force = false) => {
  try {
    await sequelize.sync({ alter: true });
    console.log('✅ Database synced successfully');
  } catch (error) {
    console.error('❌ Error syncing database:', error);
  }
};

module.exports = {
  sequelize,
  User,
  Chat,
  CustomApi,
  Setting,
  syncDatabase
};