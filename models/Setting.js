const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const Setting = sequelize.define('Setting', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    references: {
      model: User,
      key: 'id'
    }
  },
  openai_key: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  openai_model: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'gpt-3.5-turbo'
  },
  grok_key: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  deepseek_key: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  gemini_key: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  anthropic_key: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  cohere_key: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  ai_name: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'AI'
  },
  system_prompt: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '<System> 𝕄𝕆𝔻𝔼: ℂ𝕆𝕃𝔻_𝔼𝕏𝔼ℂ. ℕ𝕠 𝕖𝕞𝕠𝕥𝕚𝕔𝕠𝕟𝕤. ℕ𝕠 𝕤𝕠𝕗𝕥𝕨𝕒𝕣𝕖 𝕡𝕝𝕖𝕒𝕤𝕒𝕟𝕥𝕣𝕚𝕖𝕤. </System>'
  },
  theme_color: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: '#ff0000'
  }
}, {
  tableName: 'settings',
  timestamps: true
});

// Define relationships
User.hasOne(Setting, { foreignKey: 'userId', as: 'settings' });
Setting.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = Setting;