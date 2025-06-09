export default () => ({
  port: parseInt(process.env.PORT, 10) || 10443,
});
